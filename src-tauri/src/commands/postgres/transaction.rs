use crate::error::AppError;
use sqlx::{PgPool, Postgres, Transaction};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;

use super::query::{run_wrapped_on, PgQueryResult};
use super::statement::caller_sql;
use super::AppContext;

// `failed`: PostgreSQL answers COMMIT of a transaction that hit an error by rolling
// it back, and reports success — so a failed run is remembered to say so instead.
struct Held {
    tx: Option<Transaction<'static, Postgres>>,
    failed: bool,
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
        let held = Held { tx: Some(tx), failed: false };
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

    pub async fn finish(&self, tx_id: &str, commit: bool) -> Result<(), AppError> {
        let held = self.open.lock().unwrap().remove(tx_id).ok_or_else(ended)?;
        let mut held = held.lock().await;
        let tx = held.tx.take().ok_or_else(ended)?;
        if commit && held.failed {
            tx.rollback().await.map_err(AppError::Postgres)?;
            return Err(AppError::Validation(
                "A statement in this transaction failed, so PostgreSQL rolled it back; nothing was committed.".to_string(),
            ));
        }
        match commit {
            true => tx.commit().await,
            false => tx.rollback().await,
        }
        .map_err(AppError::Postgres)
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

#[tauri::command]
pub async fn commit_pg_transaction(txs: State<'_, PgTransactions>, tx_id: String) -> Result<(), AppError> {
    txs.finish(&tx_id, true).await
}

#[tauri::command]
pub async fn rollback_pg_transaction(txs: State<'_, PgTransactions>, tx_id: String) -> Result<(), AppError> {
    txs.finish(&tx_id, false).await
}
