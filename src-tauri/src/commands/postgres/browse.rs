use crate::error::AppError;
use std::collections::BTreeMap;
use tauri::State;

use super::query::run_wrapped;
use crate::commands::sql::{self, ColumnFilter, ColumnRef, FilterOp, SqlQueryResult, TableJoin, ROW_RESULT_CAP};
use super::row_write::column_types;
use super::array_literal::array_literal;
use super::{primary_key_columns, quote_ident, AppContext};

/// Default page size for `browse_pg_table` when the caller sends a non-positive
/// `limit` — mirrors `find_documents`' `FIND_LIMIT_FALLBACK`.
const BROWSE_LIMIT_FALLBACK: i64 = 100;

/// `"t<table>"."column"`, refused when `table` names none of the first `tables`.
fn column_sql(table: usize, column: &str, tables: usize) -> Result<String, AppError> {
    if table >= tables {
        return Err(AppError::Validation(format!("\"{column}\" names a table that isn't in this browse.")));
    }
    Ok(format!("\"t{table}\".{}", quote_ident(column)?))
}

/// The FROM's tables, quoted as identifiers (see `sql::from_clause`).
fn from_clause(schema: &str, table: &str, joins: &[TableJoin]) -> Result<String, AppError> {
    sql::from_clause(quote_ident, schema, table, joins)
}

/// The ` WHERE …` clause (empty for no filters) and the values its `$n`
/// placeholders take. `types` holds each table's column types, in table order.
/// Only quoted identifiers and catalog type names reach the SQL text; every value
/// is bound.
fn where_clause(filters: &[ColumnFilter], types: &[BTreeMap<String, String>]) -> Result<(String, Vec<String>), AppError> {
    let mut conditions = Vec::with_capacity(filters.len());
    let mut binds = Vec::new();
    for f in filters {
        let Some(pg_type) = types.get(f.table).and_then(|t| t.get(&f.column)) else {
            return Err(AppError::Validation(format!("Unknown column \"{}\".", f.column)));
        };
        let column = column_sql(f.table, &f.column, types.len())?;
        let check = match f.op {
            FilterOp::IsNull => Some("IS NULL"),
            FilterOp::NotNull => Some("IS NOT NULL"),
            _ => None,
        };
        if let Some(check) = check {
            conditions.push(format!("{column} {check}"));
            continue;
        }
        let Some(value) = &f.value else {
            return Err(AppError::Validation(format!("The filter on \"{}\" needs a value.", f.column)));
        };
        let n = binds.len() + 1;
        // ILIKE's default escape character is a backslash.
        let like = || value.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        let compare = |symbol: &str| (value.clone(), format!("{column} {symbol} ${n}::{pg_type}"));
        let (bind, condition) = match f.op {
            FilterOp::Contains => (like(), format!("{column}::text ILIKE '%' || ${n} || '%'")),
            FilterOp::StartsWith => (like(), format!("{column}::text ILIKE ${n} || '%'")),
            FilterOp::In => (listed(value, &f.column)?, format!("{column} = ANY(${n}::{pg_type}[])")),
            FilterOp::Eq => compare("="),
            FilterOp::Ne => compare("<>"),
            FilterOp::Gt => compare(">"),
            FilterOp::Gte => compare(">="),
            FilterOp::Lt => compare("<"),
            FilterOp::Lte => compare("<="),
            FilterOp::IsNull | FilterOp::NotNull => continue,
        };
        binds.push(bind);
        conditions.push(condition);
    }
    if conditions.is_empty() {
        return Ok((String::new(), binds));
    }
    Ok((format!(" WHERE {}", conditions.join(" AND ")), binds))
}

/// An any-of filter's comma-separated values as an array literal, each trimmed.
fn listed(value: &str, column: &str) -> Result<String, AppError> {
    let items: Vec<serde_json::Value> =
        value.split(',').map(str::trim).filter(|v| !v.is_empty()).map(|v| serde_json::Value::String(v.to_string())).collect();
    if items.is_empty() {
        return Err(AppError::Validation(format!("The filter on \"{column}\" needs at least one value.")));
    }
    Ok(array_literal(&items))
}

/// The FROM and WHERE of a browse, and the WHERE's bound values. Column types are
/// only needed, and so only fetched, when there is something to filter.
async fn from_where_sql(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    joins: &[TableJoin],
    filters: &[ColumnFilter],
) -> Result<(String, Vec<String>), AppError> {
    let from = from_clause(schema, table, joins)?;
    if filters.is_empty() {
        return Ok((from, Vec::new()));
    }
    let mut types = vec![column_types(pool, schema, table).await?];
    for join in joins {
        types.push(column_types(pool, &join.schema, &join.table).await?);
    }
    let (where_sql, binds) = where_clause(filters, &types)?;
    Ok((format!("{from}{where_sql}"), binds))
}

pub(crate) async fn browse_table_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    joins: &[TableJoin],
    filters: &[ColumnFilter],
    order_by: Option<&ColumnRef>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<SqlQueryResult, AppError> {
    let (from_where, binds) = from_where_sql(pool, schema, table, joins, filters).await?;
    let effective_limit = if limit <= 0 { BROWSE_LIMIT_FALLBACK } else { limit.min(ROW_RESULT_CAP) };
    let effective_offset = offset.max(0);

    // `LIMIT`/`OFFSET` alone promise nothing about which rows land on which page —
    // without a total `ORDER BY`, Postgres may return rows that tie in a different order
    // on every call, so they repeat or vanish between pages (see `sql::order_clause`).
    // A table with no primary key still pages, just without that guarantee.
    let chosen = order_by.filter(|r| !r.column.is_empty()).map(|r| column_sql(r.table, &r.column, joins.len() + 1)).transpose()?;
    let mut keys = Vec::new();
    for (i, (schema, table)) in std::iter::once((schema, table)).chain(joins.iter().map(|j| (j.schema.as_str(), j.table.as_str()))).enumerate() {
        for column in primary_key_columns(pool, schema, table).await? {
            keys.push(column_sql(i, &column, joins.len() + 1)?);
        }
    }

    // Each table's columns in its own order, so a caller can tell `t0.id` from `t1.id`
    // by position.
    let select: Vec<String> = (0..=joins.len()).map(|i| format!("\"t{i}\".*")).collect();
    let order = sql::order_clause(chosen, keys, descending);
    let inner = format!("SELECT {} FROM {from_where}{order} LIMIT {effective_limit} OFFSET {effective_offset}", select.join(", "));

    run_wrapped(pool, &inner, &binds, None).await
}

/// Paged `SELECT *` over one table or view, with optional joins — the table-browse
/// workspace's core. `order_by` (with `order_table`, 0 for the browsed table) is
/// quoted as an identifier and nothing more: an unknown column name fails with
/// Postgres's own "column does not exist" rather than being validated again here.
#[tauri::command]
pub async fn browse_pg_table(
    ctx: State<'_, AppContext>,
    id: String,
    schema: String,
    table: String,
    joins: Option<Vec<TableJoin>>,
    filters: Option<Vec<ColumnFilter>>,
    order_by: Option<String>,
    order_table: Option<usize>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<SqlQueryResult, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    let order = order_by.map(|column| ColumnRef { table: order_table.unwrap_or(0), column });
    let (joins, filters) = (joins.unwrap_or_default(), filters.unwrap_or_default());
    browse_table_impl(&pool, &schema, &table, &joins, &filters, order.as_ref(), descending, limit, offset).await
}

pub(crate) async fn count_table_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    joins: &[TableJoin],
    filters: &[ColumnFilter],
) -> Result<i64, AppError> {
    let (from_where, binds) = from_where_sql(pool, schema, table, joins, filters).await?;
    let mut query = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {from_where}")));
    for bind in binds {
        query = query.bind(bind);
    }
    match query.fetch_one(pool).await {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Postgres(e)),
    }
}

/// Total row count for `browse_pg_table`'s pagination — a separate call rather
/// than folded into the browse result (joins included, so it counts joined rows), so paging to page 2 doesn't pay for a
/// fresh `COUNT(*)` on every page the way a naive combined query would.
#[tauri::command]
pub async fn count_pg_table(
    ctx: State<'_, AppContext>,
    id: String,
    schema: String,
    table: String,
    joins: Option<Vec<TableJoin>>,
    filters: Option<Vec<ColumnFilter>>,
) -> Result<i64, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    count_table_impl(&pool, &schema, &table, &joins.unwrap_or_default(), &filters.unwrap_or_default()).await
}

#[cfg(test)]
#[path = "browse.test.rs"]
mod tests;
