use crate::error::AppError;
use tauri::State;

use super::AppContext;

/// The query plan PostgreSQL chose for `sql`, with real timings — `EXPLAIN (ANALYZE,
/// FORMAT JSON)`, as the JSON array it returns. ANALYZE actually runs the query, so it
/// runs inside a transaction that is always rolled back (read-only too on a read-only
/// connection): explaining never leaves a change behind. Sequences are the one thing
/// a rollback can't undo — a `nextval()` still advances.
pub(crate) async fn explain_impl(pool: &sqlx::PgPool, sql: &str, read_only: bool) -> Result<serde_json::Value, AppError> {
    let trimmed = sql.trim().trim_end_matches(';');
    if trimmed.is_empty() {
        return Err(AppError::Validation("Enter a query to explain.".to_string()));
    }
    let mut tx = match pool.begin().await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    let mut result = Ok(serde_json::Value::Null);
    if read_only {
        if let Err(e) = sqlx::query("SET TRANSACTION READ ONLY").execute(&mut *tx).await {
            result = Err(AppError::Postgres(e));
        }
    }
    if result.is_ok() {
        // `sql` is the caller's own query, run as-is — the same trust as run_pg_query.
        let explain = format!("EXPLAIN (ANALYZE, FORMAT JSON) {trimmed}");
        result = match sqlx::query_scalar::<_, serde_json::Value>(sqlx::AssertSqlSafe(explain)).fetch_one(&mut *tx).await {
            Ok(plan) => Ok(plan),
            Err(e) => Err(AppError::Postgres(e)),
        };
    }
    let _ = tx.rollback().await;
    result
}

#[tauri::command]
pub async fn explain_pg_query(ctx: State<'_, AppContext>, id: String, sql: String) -> Result<serde_json::Value, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    let read_only = ctx.is_read_only(&id);
    explain_impl(&pool, &sql, read_only).await
}
