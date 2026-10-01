use crate::error::AppError;
use crate::pg_row_history::PgHistoryEntry;
use sqlx::{PgPool, Postgres, Transaction};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;

use super::query::{run_wrapped_on, PgQueryResult};
use super::row_write::execute_write;
use super::statement::caller_sql;
use super::AppContext;

// `failed`: PostgreSQL answers COMMIT of a transaction that hit an error by rolling
// it back, and reports success — so a failed run is remembered to say so instead.
// `pending_history`: row edits recorded only once the transaction actually commits
// (ozendb-h4y) — recording them as each statement runs would log edits a later
// rollback undoes, which is worse than not recording them at all.
struct Held {
    tx: Option<Transaction<'static, Postgres>>,
    failed: bool,
    pending_history: Vec<PgHistoryEntry>,
}

/// The SQL tabs' Manual-mode transactions, each held open on its own connection under
/// an id the tab chose, until committed or rolled back. Dropping one (the app closing)
/// rolls it back.
#[derive(Default)]
pub struct PgTransactions {
    open: Mutex<HashMap<String, Arc<tokio::sync::Mutex<Held>>>>,
}

fn ended() -> AppError {
    AppError::Validation("That transaction has already ended.".to_string())
}

impl PgTransactions {
    /// A read-only connection holds a read-only transaction, as its auto-commit runs are.
    pub async fn begin(&self, pool: &PgPool, tx_id: &str, read_only: bool) -> Result<(), AppError> {
        let mut tx = pool.begin().await.map_err(AppError::Postgres)?;
        if read_only {
            sqlx::query("SET TRANSACTION READ ONLY").execute(&mut *tx).await.map_err(AppError::Postgres)?;
        }
        let held = Held { tx: Some(tx), failed: false, pending_history: Vec::new() };
        self.open.lock().unwrap().insert(tx_id.to_string(), Arc::new(tokio::sync::Mutex::new(held)));
        Ok(())
    }

    fn held(&self, tx_id: &str) -> Result<Arc<tokio::sync::Mutex<Held>>, AppError> {
        self.open.lock().unwrap().get(tx_id).cloned().ok_or_else(ended)
    }

    pub async fn run(&self, tx_id: &str, sql: &str, run_id: Option<&str>) -> Result<PgQueryResult, AppError> {
        let sql = caller_sql(sql)?;
        let held = self.held(tx_id)?;
        let mut held = held.lock().await;
        let tx = held.tx.as_mut().ok_or_else(ended)?;
        let result = run_wrapped_on(tx, sql, &[], run_id).await;
        if matches!(result, Err(AppError::Postgres(_))) {
            held.failed = true;
        }
        result
    }

    /// Runs a pre-built write (from `build_update`/`build_delete`) against this
    /// held transaction instead of the pool — `run`'s sibling for a statement
    /// that already has its own binds rather than arbitrary caller SQL. `history`,
    /// when given, is queued to record only if the transaction goes on to commit
    /// (see `pending_history`) — never recorded at all if it rolls back instead.
    pub async fn execute(
        &self,
        tx_id: &str,
        sql: String,
        binds: Vec<Option<String>>,
        history: Option<PgHistoryEntry>,
    ) -> Result<u64, AppError> {
        let held = self.held(tx_id)?;
        let mut held = held.lock().await;
        let tx = held.tx.as_mut().ok_or_else(ended)?;
        // `execute_write` is generic over `Executor`, which sqlx implements for
        // `&mut PgConnection` but not `&mut Transaction` directly (unlike the
        // concrete `&mut PgConnection` parameter `run_wrapped_on` takes above,
        // where the same coercion happens implicitly) — so the deref is explicit.
        let result = execute_write(sql, binds, &mut **tx).await;
        match &result {
            Ok(affected) if *affected > 0 => {
                if let Some(entry) = history {
                    held.pending_history.push(entry);
                }
            }
            Err(AppError::Postgres(_)) => held.failed = true,
            _ => {}
        }
        result
    }

    /// Ends the transaction, returning any row edits it queued (`execute`'s
    /// `history`) to record now that they're durable — empty on a rollback, or on
    /// a commit that found an earlier statement had failed (nothing was committed).
    pub async fn finish(&self, tx_id: &str, commit: bool) -> Result<Vec<PgHistoryEntry>, AppError> {
        let held = self.open.lock().unwrap().remove(tx_id).ok_or_else(ended)?;
        let mut held = held.lock().await;
        let tx = held.tx.take().ok_or_else(ended)?;
        if commit && held.failed {
            tx.rollback().await.map_err(AppError::Postgres)?;
            return Err(AppError::Validation(
                "A statement in this transaction failed, so PostgreSQL rolled it back; nothing was committed.".to_string(),
            ));
        }
        let outcome = match commit {
            true => tx.commit().await,
            false => tx.rollback().await,
        };
        match outcome {
            Ok(()) if commit => Ok(std::mem::take(&mut held.pending_history)),
            Ok(()) => Ok(Vec::new()),
            Err(e) => Err(AppError::Postgres(e)),
        }
    }
}

#[tauri::command]
pub async fn begin_pg_transaction(
    ctx: State<'_, AppContext>,
    txs: State<'_, PgTransactions>,
    id: String,
    tx_id: String,
) -> Result<(), AppError> {
    let pool = ctx.pg_pool(&id).await?;
    txs.begin(&pool, &tx_id, ctx.is_read_only(&id)).await
}

/// Commits, then records any row edits the transaction queued (ozendb-h4y) — a
/// best-effort write to the history store; a failure to record never fails the
/// commit that already happened.
#[tauri::command]
pub async fn commit_pg_transaction(
    txs: State<'_, PgTransactions>,
    history: State<'_, crate::pg_row_history::PgRowHistoryStore>,
    tx_id: String,
) -> Result<(), AppError> {
    let entries = txs.finish(&tx_id, true).await?;
    for entry in entries {
        let _ = history.push(entry);
    }
    Ok(())
}

#[tauri::command]
pub async fn rollback_pg_transaction(txs: State<'_, PgTransactions>, tx_id: String) -> Result<(), AppError> {
    txs.finish(&tx_id, false).await?;
    Ok(())
}
