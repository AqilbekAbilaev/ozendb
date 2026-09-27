use crate::error::AppError;
use tauri::State;

use super::query::{run_wrapped, PgQueryResult, ROW_RESULT_CAP};
use super::{primary_key_columns, quote_ident, AppContext};

/// Default page size for `browse_pg_table` when the caller sends a non-positive
/// `limit` — mirrors `find_documents`' `FIND_LIMIT_FALLBACK`.
const BROWSE_LIMIT_FALLBACK: i64 = 100;

pub(crate) async fn browse_table_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    order_by: Option<&str>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<PgQueryResult, AppError> {
    let qualified = format!("{}.{}", quote_ident(schema)?, quote_ident(table)?);
    let effective_limit = if limit <= 0 { BROWSE_LIMIT_FALLBACK } else { limit.min(ROW_RESULT_CAP) };
    let effective_offset = offset.max(0);

    // `LIMIT`/`OFFSET` alone promise nothing about which rows land on which page
    // — without an `ORDER BY`, Postgres is free to return them in a different
    // order on every call, so rows can repeat or vanish between pages. An
    // explicit `order_by` is quoted and used as given; absent one, this falls
    // back to the primary key (stable and always unique) rather than paging
    // unordered. A table with no primary key still pages, just without that
    // guarantee — nothing safe to default to in that case.
    let order_columns: Vec<String> = match order_by.filter(|s| !s.is_empty()) {
        Some(col) => vec![quote_ident(col)?],
        None => {
            let pk = primary_key_columns(pool, schema, table).await?;
            let mut quoted = Vec::with_capacity(pk.len());
            for column in &pk {
                quoted.push(quote_ident(column)?);
            }
            quoted
        }
    };

    let mut inner = format!("SELECT * FROM {qualified}");
    if !order_columns.is_empty() {
        // The direction applies to every column individually — `ORDER BY a, b
        // DESC` (only `b` gets the suffix) is `a ASC, b DESC`, not "both
        // descending" — confirmed against a live composite-key table.
        let direction = if descending { "DESC" } else { "ASC" };
        let ordered: Vec<String> = order_columns.iter().map(|c| format!("{c} {direction}")).collect();
        inner.push_str(&format!(" ORDER BY {}", ordered.join(", ")));
    }
    inner.push_str(&format!(" LIMIT {effective_limit} OFFSET {effective_offset}"));

    run_wrapped(pool, &inner).await
}

/// Paged `SELECT *` over one table or view — the table-browse workspace's core.
/// `order_by`, when given, is quoted as an identifier and nothing more: an
/// unknown column name fails with Postgres's own "column does not exist" rather
/// than being validated against `list_pg_columns` again here.
#[tauri::command]
pub async fn browse_pg_table(
    ctx: State<'_, AppContext>,
    id: String,
    schema: String,
    table: String,
    order_by: Option<String>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<PgQueryResult, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    browse_table_impl(&pool, &schema, &table, order_by.as_deref(), descending, limit, offset).await
}

pub(crate) async fn count_table_impl(pool: &sqlx::PgPool, schema: &str, table: &str) -> Result<i64, AppError> {
    let qualified = format!("{}.{}", quote_ident(schema)?, quote_ident(table)?);
    match sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {qualified}")))
        .fetch_one(pool)
        .await
    {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Postgres(e)),
    }
}

/// Total row count for `browse_pg_table`'s pagination — a separate call rather
/// than folded into the browse result, so paging to page 2 doesn't pay for a
/// fresh `COUNT(*)` on every page the way a naive combined query would.
#[tauri::command]
pub async fn count_pg_table(ctx: State<'_, AppContext>, id: String, schema: String, table: String) -> Result<i64, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    count_table_impl(&pool, &schema, &table).await
}
