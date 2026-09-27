use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::State;

use super::query::{column_types, run_wrapped, PgQueryResult, ROW_RESULT_CAP};
use super::{primary_key_columns, quote_ident, AppContext};

/// Default page size for `browse_pg_table` when the caller sends a non-positive
/// `limit` — mirrors `find_documents`' `FIND_LIMIT_FALLBACK`.
const BROWSE_LIMIT_FALLBACK: i64 = 100;

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOp {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    IsNull,
    NotNull,
}

/// One condition on a browsed table's column. `value` is text, cast to the
/// column's own type by the server, so `qty > 9` compares numbers, not strings.
#[derive(Debug, PartialEq, Deserialize, Serialize)]
pub struct ColumnFilter {
    pub column: String,
    pub op: FilterOp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// The ` WHERE …` clause (empty for no filters) and the values its `$n`
/// placeholders take. Only quoted identifiers and catalog type names reach the
/// SQL text; every value is bound.
fn where_clause(filters: &[ColumnFilter], types: &BTreeMap<String, String>) -> Result<(String, Vec<String>), AppError> {
    let mut conditions = Vec::with_capacity(filters.len());
    let mut binds = Vec::new();
    for f in filters {
        let Some(pg_type) = types.get(&f.column) else {
            return Err(AppError::Validation(format!("Unknown column \"{}\".", f.column)));
        };
        let column = quote_ident(&f.column)?;
        let comparison = match f.op {
            FilterOp::IsNull => {
                conditions.push(format!("{column} IS NULL"));
                continue;
            }
            FilterOp::NotNull => {
                conditions.push(format!("{column} IS NOT NULL"));
                continue;
            }
            FilterOp::Contains => None,
            FilterOp::Eq => Some("="),
            FilterOp::Ne => Some("<>"),
            FilterOp::Gt => Some(">"),
            FilterOp::Gte => Some(">="),
            FilterOp::Lt => Some("<"),
            FilterOp::Lte => Some("<="),
        };
        let Some(value) = &f.value else {
            return Err(AppError::Validation(format!("The filter on \"{}\" needs a value.", f.column)));
        };
        let n = binds.len() + 1;
        match comparison {
            Some(op) => {
                binds.push(value.clone());
                conditions.push(format!("{column} {op} ${n}::{pg_type}"));
            }
            None => {
                // ILIKE's default escape character is a backslash.
                binds.push(value.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
                conditions.push(format!("{column}::text ILIKE '%' || ${n} || '%'"));
            }
        }
    }
    if conditions.is_empty() {
        return Ok((String::new(), binds));
    }
    Ok((format!(" WHERE {}", conditions.join(" AND ")), binds))
}

/// Types are only needed, and so only fetched, when there is something to filter.
async fn filter_sql(pool: &sqlx::PgPool, schema: &str, table: &str, filters: &[ColumnFilter]) -> Result<(String, Vec<String>), AppError> {
    if filters.is_empty() {
        return Ok((String::new(), Vec::new()));
    }
    where_clause(filters, &column_types(pool, schema, table).await?)
}

pub(crate) async fn browse_table_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    filters: &[ColumnFilter],
    order_by: Option<&str>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<PgQueryResult, AppError> {
    let qualified = format!("{}.{}", quote_ident(schema)?, quote_ident(table)?);
    let (where_sql, binds) = filter_sql(pool, schema, table, filters).await?;
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

    let mut inner = format!("SELECT * FROM {qualified}{where_sql}");
    if !order_columns.is_empty() {
        // The direction applies to every column individually — `ORDER BY a, b
        // DESC` (only `b` gets the suffix) is `a ASC, b DESC`, not "both
        // descending" — confirmed against a live composite-key table.
        let direction = if descending { "DESC" } else { "ASC" };
        let ordered: Vec<String> = order_columns.iter().map(|c| format!("{c} {direction}")).collect();
        inner.push_str(&format!(" ORDER BY {}", ordered.join(", ")));
    }
    inner.push_str(&format!(" LIMIT {effective_limit} OFFSET {effective_offset}"));

    run_wrapped(pool, &inner, &binds).await
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
    filters: Option<Vec<ColumnFilter>>,
    order_by: Option<String>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<PgQueryResult, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    let filters = filters.unwrap_or_default();
    browse_table_impl(&pool, &schema, &table, &filters, order_by.as_deref(), descending, limit, offset).await
}

pub(crate) async fn count_table_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    filters: &[ColumnFilter],
) -> Result<i64, AppError> {
    let qualified = format!("{}.{}", quote_ident(schema)?, quote_ident(table)?);
    let (where_sql, binds) = filter_sql(pool, schema, table, filters).await?;
    let mut query = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {qualified}{where_sql}")));
    for bind in binds {
        query = query.bind(bind);
    }
    match query.fetch_one(pool).await {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Postgres(e)),
    }
}

/// Total row count for `browse_pg_table`'s pagination — a separate call rather
/// than folded into the browse result, so paging to page 2 doesn't pay for a
/// fresh `COUNT(*)` on every page the way a naive combined query would.
#[tauri::command]
pub async fn count_pg_table(
    ctx: State<'_, AppContext>,
    id: String,
    schema: String,
    table: String,
    filters: Option<Vec<ColumnFilter>>,
) -> Result<i64, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    count_table_impl(&pool, &schema, &table, &filters.unwrap_or_default()).await
}

#[cfg(test)]
#[path = "browse.test.rs"]
mod tests;
