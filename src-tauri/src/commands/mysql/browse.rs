//! The table tab's page and row count over one MySQL table. Names are quoted with
//! backticks and every filter value is bound, never written into the SQL.
use sqlx::{Column, Executor, MySqlPool, Row, SqlSafeStr, Statement};
use tauri::State;

use super::cell::cell;
use super::schema::{mysql_columns, MySqlColumnInfo};
use super::{quote_name, AppContext};
use crate::commands::sql::{ColumnFilter, FilterOp, SqlQueryResult, ROW_RESULT_CAP};
use crate::error::AppError;

/// The page size when the caller sends a non-positive `limit`, as PostgreSQL's browse does.
const BROWSE_LIMIT_FALLBACK: i64 = 100;

/// The exact numeric types, BIT among them, whose filter values are read as a DECIMAL.
const EXACT_NUMBERS: [&str; 7] = ["tinyint", "smallint", "mediumint", "int", "bigint", "decimal", "bit"];

/// The most fraction digits a MySQL DECIMAL holds.
const MAX_SCALE: usize = 30;

// Contains and starts-with ignore case whatever the column's collation, as PostgreSQL's
// ILIKE does: the column is read as utf8mb4 text so any type can be matched, under a
// case-insensitive collation every MySQL and MariaDB server has.
const AS_TEXT: &str = "COLLATE utf8mb4_general_ci";

/// The browsed column named `name`, refused when the table has none.
fn column<'a>(columns: &'a [MySqlColumnInfo], name: &str) -> Result<&'a MySqlColumnInfo, AppError> {
    columns.iter().find(|c| c.name == name).ok_or_else(|| AppError::Validation(format!("Unknown column \"{name}\".")))
}

/// A filter value as it is bound, and the placeholder that reads it. An exact number's
/// value is read as a DECIMAL with the value's own fraction digits: a bare `?` compares
/// as floating point, which can't tell two BIGINTs past 2^53 apart; a cast to SIGNED
/// reads `>= 1.5` as `>= 1`; one to the column's own scale reads `> 1.505` on a
/// DECIMAL(10,2) as `> 1.51`; and one to a fixed DECIMAL(65,30) clips a value past 35
/// whole digits. On TINYINT(1), MySQL's BOOLEAN, `true` and `false` are the 1 and 0 it stores.
fn typed(data_type: &str, value: &str) -> (String, String) {
    let base = data_type.split(['(', ' ']).next().unwrap_or_default();
    if !EXACT_NUMBERS.contains(&base) {
        return (value.to_string(), String::from("?"));
    }
    let is_boolean = data_type.strip_prefix("tinyint(1)").is_some_and(|rest| rest.is_empty() || rest.starts_with(' '));
    let value = match value.to_ascii_lowercase().as_str() {
        "true" if is_boolean => "1",
        "false" if is_boolean => "0",
        _ => value,
    };
    (value.to_string(), format!("CAST(? AS DECIMAL(65,{}))", scale(value)))
}

/// The fraction digits `value` is written with, up to MySQL's limit; the limit itself
/// for a number written with an exponent, whose digits aren't counted.
fn scale(value: &str) -> usize {
    if value.contains(['e', 'E']) {
        return MAX_SCALE;
    }
    let digits = value.split_once('.').map_or(0, |(_, fraction)| fraction.chars().take_while(char::is_ascii_digit).count());
    digits.min(MAX_SCALE)
}

/// The ` WHERE …` clause (empty for no filters) and the values its placeholders take.
pub(super) fn where_clause(filters: &[ColumnFilter], columns: &[MySqlColumnInfo]) -> Result<(String, Vec<String>), AppError> {
    let mut conditions = Vec::with_capacity(filters.len());
    let mut binds = Vec::new();
    for f in filters {
        if f.table != 0 {
            return Err(AppError::Validation(format!("\"{}\" names a table that isn't in this browse.", f.column)));
        }
        let info = column(columns, &f.column)?;
        let name = quote_name(&f.column)?;
        let value = || f.value.as_deref().ok_or_else(|| AppError::Validation(format!("The filter on \"{}\" needs a value.", f.column)));
        // LIKE's default escape character is a backslash.
        let like = |value: &str| value.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        let as_text = format!("CONVERT({name} USING utf8mb4) {AS_TEXT} LIKE");
        let compare = |symbol: &str, value: &str| {
            let (value, placeholder) = typed(&info.data_type, value);
            (vec![value], format!("{name} {symbol} {placeholder}"))
        };
        let (values, condition) = match f.op {
            FilterOp::IsNull => (vec![], format!("{name} IS NULL")),
            FilterOp::NotNull => (vec![], format!("{name} IS NOT NULL")),
            FilterOp::Contains => (vec![like(value()?)], format!("{as_text} CONCAT('%', ?, '%')")),
            FilterOp::StartsWith => (vec![like(value()?)], format!("{as_text} CONCAT(?, '%')")),
            FilterOp::In => {
                let (items, placeholders): (Vec<String>, Vec<String>) = value()?
                    .split(',')
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(|v| typed(&info.data_type, v))
                    .unzip();
                if items.is_empty() {
                    return Err(AppError::Validation(format!("The filter on \"{}\" needs at least one value.", f.column)));
                }
                (items, format!("{name} IN ({})", placeholders.join(", ")))
            }
            FilterOp::Eq => compare("=", value()?),
            FilterOp::Ne => compare("<>", value()?),
            FilterOp::Gt => compare(">", value()?),
            FilterOp::Gte => compare(">=", value()?),
            FilterOp::Lt => compare("<", value()?),
            FilterOp::Lte => compare("<=", value()?),
        };
        binds.extend(values);
        conditions.push(condition);
    }
    if conditions.is_empty() {
        return Ok((String::new(), binds));
    }
    Ok((format!(" WHERE {}", conditions.join(" AND ")), binds))
}

/// ` ORDER BY …` on `order_by`, or else on the primary key so pages don't overlap or skip
/// rows (see PostgreSQL's browse); empty for a table with neither.
pub(super) fn order_clause(order_by: Option<&str>, descending: bool, columns: &[MySqlColumnInfo]) -> Result<String, AppError> {
    let names: Vec<&str> = match order_by.filter(|name| !name.is_empty()) {
        Some(name) => vec![column(columns, name)?.name.as_str()],
        None => columns.iter().filter(|c| c.is_primary_key).map(|c| c.name.as_str()).collect(),
    };
    if names.is_empty() {
        return Ok(String::new());
    }
    let direction = if descending { "DESC" } else { "ASC" };
    let ordered: Result<Vec<String>, AppError> = names.iter().map(|name| Ok(format!("{} {direction}", quote_name(name)?))).collect();
    Ok(format!(" ORDER BY {}", ordered?.join(", ")))
}

/// `FROM` the table, with its `WHERE` and the values that clause binds.
fn from_where(database: &str, table: &str, filters: &[ColumnFilter], columns: &[MySqlColumnInfo]) -> Result<(String, Vec<String>), AppError> {
    let (where_sql, binds) = where_clause(filters, columns)?;
    Ok((format!("FROM {}.{}{where_sql}", quote_name(database)?, quote_name(table)?), binds))
}

pub(crate) async fn mysql_browse(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    filters: &[ColumnFilter],
    order_by: Option<&str>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<SqlQueryResult, AppError> {
    let columns = mysql_columns(pool, database, table).await?;
    let (from_where, binds) = from_where(database, table, filters, &columns)?;
    let limit = if limit <= 0 { BROWSE_LIMIT_FALLBACK } else { limit.min(ROW_RESULT_CAP) };
    let sql = format!("SELECT * {from_where}{} LIMIT ? OFFSET ?", order_clause(order_by, descending, &columns)?);

    let mut conn = pool.acquire().await.map_err(AppError::MySql)?;
    // The statement's own columns name the result, so an empty page still has a header.
    let statement = (&mut *conn).prepare(sqlx::AssertSqlSafe(sql.clone()).into_sql_str()).await.map_err(AppError::MySql)?;
    let names: Vec<String> = statement.columns().iter().map(|c| c.name().to_string()).collect();
    let declared: Vec<Option<&str>> =
        names.iter().map(|name| columns.iter().find(|c| &c.name == name).map(|c| c.data_type.as_str())).collect();
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    for bind in binds {
        query = query.bind(bind);
    }
    query = query.bind(limit).bind(offset.max(0));
    let started = std::time::Instant::now();
    let fetched = query.fetch_all(&mut *conn).await.map_err(AppError::MySql)?;
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let mut rows = Vec::with_capacity(fetched.len());
    for row in &fetched {
        let mut cells = Vec::with_capacity(names.len());
        for i in 0..row.len() {
            cells.push(cell(row.try_get_raw(i).map_err(AppError::MySql)?, declared.get(i).copied().flatten()));
        }
        rows.push(cells);
    }
    Ok(SqlQueryResult { columns: names, rows, truncated: false, elapsed_ms, rows_affected: None })
}

/// A page of one table or view: `filters` must all hold, `order_by` names one of its
/// columns (the primary key when absent). Read through the connection's own pool, as the
/// catalog is: the SQL names the database, so no pool opens per database.
#[tauri::command]
pub async fn browse_mysql_table(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    table: String,
    filters: Option<Vec<ColumnFilter>>,
    order_by: Option<String>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<SqlQueryResult, AppError> {
    let pool = ctx.mysql_pool(&id, None).await?;
    mysql_browse(&pool, &database, &table, &filters.unwrap_or_default(), order_by.as_deref(), descending, limit, offset).await
}

pub(crate) async fn mysql_count(pool: &MySqlPool, database: &str, table: &str, filters: &[ColumnFilter]) -> Result<i64, AppError> {
    let columns = if filters.is_empty() { Vec::new() } else { mysql_columns(pool, database, table).await? };
    let (from_where, binds) = from_where(database, table, filters, &columns)?;
    let mut query = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) {from_where}")));
    for bind in binds {
        query = query.bind(bind);
    }
    query.fetch_one(pool).await.map_err(AppError::MySql)
}

/// The row count `browse_mysql_table`'s paging reads, asked for separately so turning a
/// page doesn't count the table again.
#[tauri::command]
pub async fn count_mysql_table(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    table: String,
    filters: Option<Vec<ColumnFilter>>,
) -> Result<i64, AppError> {
    let pool = ctx.mysql_pool(&id, None).await?;
    mysql_count(&pool, &database, &table, &filters.unwrap_or_default()).await
}

#[cfg(test)]
#[path = "browse.test.rs"]
mod tests;
