use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::State;

use super::query::{column_types, run_wrapped, PgQueryResult, ROW_RESULT_CAP};
use super::array_literal::array_literal;
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
    StartsWith,
    /// Any of a comma-separated list.
    In,
    IsNull,
    NotNull,
}

/// A column of one of the tables in a browse: `table` 0 is the table being browsed,
/// 1 and on are its joins in order.
#[derive(Debug, PartialEq, Deserialize, Serialize)]
pub struct ColumnRef {
    #[serde(default)]
    pub table: usize,
    pub column: String,
}

/// One condition on a column of a browsed table (or a join, by `table`). `value` is
/// text, cast to the column's own type by the server, so `qty > 9` compares numbers,
/// not strings.
#[derive(Debug, PartialEq, Deserialize, Serialize)]
pub struct ColumnFilter {
    #[serde(default)]
    pub table: usize,
    pub column: String,
    pub op: FilterOp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JoinKind {
    /// Keeps every row of the tables before it, matched or not.
    Left,
    /// Keeps only rows that have a match.
    Inner,
}

/// One pair a join matches on: its own `column` equals `equals`, a column of a table
/// before it.
#[derive(Debug, Deserialize, Serialize)]
pub struct JoinOn {
    pub column: String,
    pub equals: ColumnRef,
}

/// A table joined into a browse, matched where every pair in `on` holds — more than one
/// for a foreign key over several columns.
#[derive(Debug, Deserialize, Serialize)]
pub struct TableJoin {
    pub schema: String,
    pub table: String,
    pub kind: JoinKind,
    pub on: Vec<JoinOn>,
}

/// `"t<table>"."column"`, refused when `table` names none of the first `tables`.
fn column_sql(table: usize, column: &str, tables: usize) -> Result<String, AppError> {
    if table >= tables {
        return Err(AppError::Validation(format!("\"{column}\" names a table that isn't in this browse.")));
    }
    Ok(format!("\"t{table}\".{}", quote_ident(column)?))
}

/// The browsed table as `t0` and each join as `t1`, `t2`…, so a table joined to
/// itself still has a name of its own.
fn from_clause(schema: &str, table: &str, joins: &[TableJoin]) -> Result<String, AppError> {
    let mut sql = format!("{}.{} AS \"t0\"", quote_ident(schema)?, quote_ident(table)?);
    for (i, join) in joins.iter().enumerate() {
        let n = i + 1;
        if join.on.is_empty() {
            return Err(AppError::Validation(format!("The join to \"{}\" matches on no columns.", join.table)));
        }
        let mut pairs = Vec::with_capacity(join.on.len());
        for pair in &join.on {
            if pair.equals.table >= n {
                return Err(AppError::Validation(String::from("A join can only match a table that comes before it.")));
            }
            pairs.push(format!("\"t{n}\".{} = {}", quote_ident(&pair.column)?, column_sql(pair.equals.table, &pair.equals.column, n)?));
        }
        let kind = match join.kind {
            JoinKind::Left => "LEFT JOIN",
            JoinKind::Inner => "JOIN",
        };
        sql.push_str(&format!(
            " {kind} {}.{} AS \"t{n}\" ON {}",
            quote_ident(&join.schema)?,
            quote_ident(&join.table)?,
            pairs.join(" AND "),
        ));
    }
    Ok(sql)
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
) -> Result<PgQueryResult, AppError> {
    let (from_where, binds) = from_where_sql(pool, schema, table, joins, filters).await?;
    let effective_limit = if limit <= 0 { BROWSE_LIMIT_FALLBACK } else { limit.min(ROW_RESULT_CAP) };
    let effective_offset = offset.max(0);

    // `LIMIT`/`OFFSET` alone promise nothing about which rows land on which page
    // — without an `ORDER BY`, Postgres is free to return them in a different
    // order on every call, so rows can repeat or vanish between pages. An
    // explicit `order_by` is quoted and used as given; absent one, this falls
    // back to the primary key (stable and always unique) rather than paging
    // unordered. A table with no primary key still pages, just without that
    // guarantee — nothing safe to default to in that case.
    let order_columns: Vec<String> = match order_by.filter(|r| !r.column.is_empty()) {
        Some(r) => vec![column_sql(r.table, &r.column, joins.len() + 1)?],
        None => {
            let pk = primary_key_columns(pool, schema, table).await?;
            let mut quoted = Vec::with_capacity(pk.len());
            for column in &pk {
                quoted.push(column_sql(0, column, 1)?);
            }
            quoted
        }
    };

    // Each table's columns in its own order, so a caller can tell `t0.id` from `t1.id`
    // by position.
    let select: Vec<String> = (0..=joins.len()).map(|i| format!("\"t{i}\".*")).collect();
    let mut inner = format!("SELECT {} FROM {from_where}", select.join(", "));
    if !order_columns.is_empty() {
        // The direction applies to every column individually — `ORDER BY a, b
        // DESC` (only `b` gets the suffix) is `a ASC, b DESC`, not "both
        // descending" — confirmed against a live composite-key table.
        let direction = if descending { "DESC" } else { "ASC" };
        let ordered: Vec<String> = order_columns.iter().map(|c| format!("{c} {direction}")).collect();
        inner.push_str(&format!(" ORDER BY {}", ordered.join(", ")));
    }
    inner.push_str(&format!(" LIMIT {effective_limit} OFFSET {effective_offset}"));

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
) -> Result<PgQueryResult, AppError> {
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
