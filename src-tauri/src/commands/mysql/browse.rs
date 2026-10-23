//! The table tab's page and row count over one MySQL table and the tables joined to it.
//! Names are quoted with backticks and every filter value is bound, never written into
//! the SQL. A join's `schema` is the database its table is in.
use sqlx::{Column, Executor, MySqlPool, Row, SqlSafeStr, Statement};
use tauri::State;

use super::cell::{cell, digits, fraction};
use chrono::{DateTime, NaiveDateTime, TimeZone};
use std::borrow::Cow;
use super::schema::{mysql_columns, MySqlColumnInfo};
use super::{quote_name, AppContext};
use crate::commands::sql::{ColumnFilter, ColumnRef, FilterOp, JoinKind, SqlQueryResult, TableJoin, ROW_RESULT_CAP};
use crate::error::AppError;

/// The page size when the caller sends a non-positive `limit`, as PostgreSQL's browse does.
const BROWSE_LIMIT_FALLBACK: i64 = 100;

/// The exact numeric types, BIT among them, whose filter values are read as a DECIMAL.
const EXACT_NUMBERS: [&str; 7] = ["tinyint", "smallint", "mediumint", "int", "bigint", "decimal", "bit"];

/// The most digits a MySQL DECIMAL holds, and the most of them after the point.
const MAX_DIGITS: usize = 65;
const MAX_SCALE: usize = 30;

// Contains and starts-with ignore case whatever the column's collation, as PostgreSQL's
// ILIKE does: the column is read as utf8mb4 text so any type can be matched, under a
// case-insensitive collation every MySQL and MariaDB server has.
const AS_TEXT: &str = "COLLATE utf8mb4_general_ci";

/// How a refused filter value is named (see `typed`).
const FILTER: &str = "The filter on";

/// The browsed column named `name`, refused when the table has none.
pub(super) fn column<'a>(columns: &'a [MySqlColumnInfo], name: &str) -> Result<&'a MySqlColumnInfo, AppError> {
    columns.iter().find(|c| c.name == name).ok_or_else(|| AppError::Validation(format!("Unknown column \"{name}\".")))
}

/// A filter value as it is bound, and the placeholder that reads it. An exact number's
/// value is read as the smallest DECIMAL that holds it: a bare `?` compares as floating
/// point, which can't tell two BIGINTs past 2^53 apart; a cast to SIGNED reads `>= 1.5`
/// as `>= 1`; one to the column's own scale reads `> 1.505` on a DECIMAL(10,2) as
/// `> 1.51`; and one to a fixed DECIMAL(65,30) clips a value past 35 whole digits. On
/// TINYINT(1), MySQL's BOOLEAN, `true` and `false` are the 1 and 0 it stores, under every
/// operator, as MySQL reads TRUE and FALSE. A refusal starts with `what`, the caller's
/// name for the value: "The filter on" for a filter.
pub(super) fn typed(info: &MySqlColumnInfo, value: &str, what: &str) -> Result<(String, String), AppError> {
    let value = &*unzoned(&info.data_type, value);
    if !EXACT_NUMBERS.contains(&base_type(&info.data_type)) {
        return Ok((value.to_string(), String::from("?")));
    }
    let boolean = is_boolean(&info.data_type);
    let value = flag(&info.data_type, value).unwrap_or(value.trim());
    // CAST would read anything else as 0.
    let (precision, scale) = decimal(value).ok_or_else(|| {
        let or_boolean = if boolean { ", or true or false" } else { "" };
        AppError::Validation(format!("{what} \"{}\" needs a number{or_boolean}.", info.name))
    })?;
    if precision > MAX_DIGITS || scale > MAX_SCALE {
        return Err(AppError::Validation(format!(
            "{what} \"{}\" needs a number of at most {MAX_DIGITS} digits, {MAX_SCALE} of them after the point.",
            info.name
        )));
    }
    Ok((value.to_string(), format!("CAST(? AS DECIMAL({precision},{scale}))")))
}

/// A COLUMN_TYPE's name without its length or sign: `bigint` for `bigint(20) unsigned`.
pub(super) fn base_type(data_type: &str) -> &str {
    data_type.split(['(', ' ']).next().unwrap_or_default()
}

/// TINYINT(1), MySQL's BOOLEAN, signed or not.
pub(super) fn is_boolean(data_type: &str) -> bool {
    data_type.strip_prefix("tinyint(1)").is_some_and(|rest| rest.is_empty() || rest.starts_with(' '))
}

/// On TINYINT(1), `true` or `false`, in any case, as the 1 or 0 MySQL stores for it.
pub(super) fn flag(data_type: &str, value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" if is_boolean(data_type) => Some("1"),
        "false" if is_boolean(data_type) => Some("0"),
        _ => None,
    }
}

/// `value` as MySQL writes the column. The grid shows a TIMESTAMP in the user's zone with
/// its offset (cell.rs), while the session and MySQL's own text of it, which every filter
/// compares, are in UTC; so a whole date and time, with an offset or read as the user's,
/// goes back as UTC. Anything else, such as part of one for a contains, goes as it is.
pub(super) fn unzoned<'a>(data_type: &str, value: &'a str) -> Cow<'a, str> {
    match data_type.starts_with("timestamp").then(|| in_utc(value, &chrono::Local, digits(Some(data_type)))).flatten() {
        Some(utc) => Cow::Owned(utc),
        None => Cow::Borrowed(value),
    }
}

/// `value`, a date and time with an offset or else in `zone`, as UTC text to `digits`.
pub(super) fn in_utc<Z: TimeZone>(value: &str, zone: &Z, digits: Option<usize>) -> Option<String> {
    let value = value.trim();
    let at = match DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f%:z") {
        Ok(at) => at.naive_utc(),
        Err(_) => zone.from_local_datetime(&NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f").ok()?).earliest()?.naive_utc(),
    };
    Some(format!("{}{}", at.format("%Y-%m-%d %H:%M:%S"), fraction(at.and_utc().timestamp_subsec_micros(), digits)))
}

/// The precision and scale of the smallest DECIMAL that holds `value` exactly, or None
/// when it isn't a number. Counted from its digits, not read as a float, so nothing
/// rounds: `-1.50e-3` is 0.0015, a DECIMAL(4,4), and `12e3` a DECIMAL(5,0).
fn decimal(value: &str) -> Option<(usize, usize)> {
    let unsigned = value.strip_prefix(['+', '-']).unwrap_or(value);
    let (mantissa, exponent) = match unsigned.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, exponent.parse::<i64>().ok()?),
        None => (unsigned, 0),
    };
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    if whole.len() + fraction.len() == 0 || !whole.chars().chain(fraction.chars()).all(|c| c.is_ascii_digit()) {
        return None;
    }
    let digits = format!("{whole}{fraction}");
    let leading = digits.trim_start_matches('0');
    let significant = leading.trim_end_matches('0');
    if significant.is_empty() {
        return Some((1, 0));
    }
    // How many of the significant digits come before the point; negative when zeros do.
    let point = leading.len() as i128 - fraction.len() as i128 + i128::from(exponent);
    let scale = (significant.len() as i128 - point).max(0);
    Some((usize::try_from(point.max(0) + scale).ok()?, usize::try_from(scale).ok()?))
}

/// `` `t<table>`.`column` `` and its info, refused when `table` names none of `tables`
/// or has no such column.
fn column_in<'a>(tables: &'a [Vec<MySqlColumnInfo>], r: &ColumnRef) -> Result<(String, &'a MySqlColumnInfo), AppError> {
    let columns = tables.get(r.table).ok_or_else(|| AppError::Validation(format!("\"{}\" names a table that isn't in this browse.", r.column)))?;
    Ok((format!("`t{}`.{}", r.table, quote_name(&r.column)?), column(columns, &r.column)?))
}

/// The browsed table as `t0` and each join as `t1`, `t2`…, so a table joined to itself
/// still has a name of its own.
pub(super) fn from_clause(database: &str, table: &str, joins: &[TableJoin]) -> Result<String, AppError> {
    let mut sql = format!("{}.{} AS `t0`", quote_name(database)?, quote_name(table)?);
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
            pairs.push(format!("`t{n}`.{} = `t{}`.{}", quote_name(&pair.column)?, pair.equals.table, quote_name(&pair.equals.column)?));
        }
        let kind = match join.kind {
            JoinKind::Left => "LEFT JOIN",
            JoinKind::Inner => "JOIN",
        };
        sql.push_str(&format!(" {kind} {}.{} AS `t{n}` ON {}", quote_name(&join.schema)?, quote_name(&join.table)?, pairs.join(" AND ")));
    }
    Ok(sql)
}

/// The ` WHERE …` clause (empty for no filters) and the values its placeholders take.
/// `tables` holds each table's columns, the browsed table's first, then each join's.
pub(super) fn where_clause(filters: &[ColumnFilter], tables: &[Vec<MySqlColumnInfo>]) -> Result<(String, Vec<String>), AppError> {
    let mut conditions = Vec::with_capacity(filters.len());
    let mut binds = Vec::new();
    for f in filters {
        let (name, info) = column_in(tables, &ColumnRef { table: f.table, column: f.column.clone() })?;
        let value = || f.value.as_deref().ok_or_else(|| AppError::Validation(format!("The filter on \"{}\" needs a value.", f.column)));
        // LIKE's default escape character is a backslash.
        let like = |value: &str| unzoned(&info.data_type, value).replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        let as_text = format!("CONVERT({name} USING utf8mb4) {AS_TEXT} LIKE");
        let compare = |symbol: &str, value: &str| {
            let (value, placeholder) = typed(info, value, FILTER)?;
            Ok::<_, AppError>((vec![value], format!("{name} {symbol} {placeholder}")))
        };
        let (values, condition) = match f.op {
            FilterOp::IsNull => (vec![], format!("{name} IS NULL")),
            FilterOp::NotNull => (vec![], format!("{name} IS NOT NULL")),
            FilterOp::Contains => (vec![like(value()?)], format!("{as_text} CONCAT('%', ?, '%')")),
            FilterOp::StartsWith => (vec![like(value()?)], format!("{as_text} CONCAT(?, '%')")),
            FilterOp::In => {
                let pairs: Vec<(String, String)> =
                    value()?.split(',').map(str::trim).filter(|v| !v.is_empty()).map(|v| typed(info, v, FILTER)).collect::<Result<_, _>>()?;
                let (items, placeholders): (Vec<String>, Vec<String>) = pairs.into_iter().unzip();
                if items.is_empty() {
                    return Err(AppError::Validation(format!("The filter on \"{}\" needs at least one value.", f.column)));
                }
                (items, format!("{name} IN ({})", placeholders.join(", ")))
            }
            FilterOp::Eq => compare("=", value()?)?,
            FilterOp::Ne => compare("<>", value()?)?,
            FilterOp::Gt => compare(">", value()?)?,
            FilterOp::Gte => compare(">=", value()?)?,
            FilterOp::Lt => compare("<", value()?)?,
            FilterOp::Lte => compare("<=", value()?)?,
        };
        binds.extend(values);
        conditions.push(condition);
    }
    if conditions.is_empty() {
        return Ok((String::new(), binds));
    }
    Ok((format!(" WHERE {}", conditions.join(" AND ")), binds))
}

/// ` ORDER BY …` on `order_by`, a column of any of `tables`, or else on each table's
/// primary key in turn, so pages don't overlap or skip rows (see PostgreSQL's browse):
/// with a join the browsed table's key repeats once per match. Empty when no table has one.
pub(super) fn order_clause(order_by: Option<&ColumnRef>, descending: bool, tables: &[Vec<MySqlColumnInfo>]) -> Result<String, AppError> {
    let names: Vec<String> = match order_by.filter(|r| !r.column.is_empty()) {
        Some(r) => vec![column_in(tables, r)?.0],
        None => {
            let keys = tables.iter().enumerate().flat_map(|(i, columns)| columns.iter().filter(|c| c.is_primary_key).map(move |c| (i, c)));
            keys.map(|(i, c)| Ok(format!("`t{i}`.{}", quote_name(&c.name)?))).collect::<Result<_, AppError>>()?
        }
    };
    if names.is_empty() {
        return Ok(String::new());
    }
    let direction = if descending { "DESC" } else { "ASC" };
    Ok(format!(" ORDER BY {}", names.iter().map(|name| format!("{name} {direction}")).collect::<Vec<_>>().join(", ")))
}

/// Each table's columns: the browsed table's, then each join's, from whichever database it is in.
async fn tables_columns(pool: &MySqlPool, database: &str, table: &str, joins: &[TableJoin]) -> Result<Vec<Vec<MySqlColumnInfo>>, AppError> {
    let mut tables = vec![mysql_columns(pool, database, table).await?];
    for join in joins {
        tables.push(mysql_columns(pool, &join.schema, &join.table).await?);
    }
    Ok(tables)
}

/// `FROM` the tables, with the `WHERE` and the values that clause binds.
fn from_where(database: &str, table: &str, joins: &[TableJoin], filters: &[ColumnFilter], tables: &[Vec<MySqlColumnInfo>]) -> Result<(String, Vec<String>), AppError> {
    let (where_sql, binds) = where_clause(filters, tables)?;
    Ok((format!("FROM {}{where_sql}", from_clause(database, table, joins)?), binds))
}

pub(crate) async fn mysql_browse(
    pool: &MySqlPool,
    database: &str,
    table: &str,
    joins: &[TableJoin],
    filters: &[ColumnFilter],
    order_by: Option<&ColumnRef>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<SqlQueryResult, AppError> {
    let tables = tables_columns(pool, database, table, joins).await?;
    let (from_where, binds) = from_where(database, table, joins, filters, &tables)?;
    let limit = if limit <= 0 { BROWSE_LIMIT_FALLBACK } else { limit.min(ROW_RESULT_CAP) };
    // Each table's columns in its own order, so a caller can tell `t0.id` from `t1.id` by position.
    let select: Vec<String> = (0..tables.len()).map(|i| format!("`t{i}`.*")).collect();
    let sql = format!("SELECT {} {from_where}{} LIMIT ? OFFSET ?", select.join(", "), order_clause(order_by, descending, &tables)?);

    let mut conn = pool.acquire().await.map_err(AppError::MySql)?;
    // The statement's own columns name the result, so an empty page still has a header.
    let statement = (&mut *conn).prepare(sqlx::AssertSqlSafe(sql.clone()).into_sql_str()).await.map_err(AppError::MySql)?;
    let names: Vec<String> = statement.columns().iter().map(|c| c.name().to_string()).collect();
    // By place, as the tab lines its columns up: a column's origin can't tell a table
    // joined to itself from the browsed one.
    let declared: Vec<&str> = tables.iter().flatten().map(|c| c.data_type.as_str()).collect();
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
            cells.push(cell(row.try_get_raw(i).map_err(AppError::MySql)?, declared.get(i).copied()));
        }
        rows.push(cells);
    }
    Ok(SqlQueryResult { columns: names, rows, truncated: false, elapsed_ms, rows_affected: None })
}

/// A page of one table or view and the tables joined to it: `filters` must all hold,
/// `order_by` (with `order_table`, 0 for the browsed table) names a column (the primary
/// key when absent). Read through the connection's own pool, as the catalog is: the SQL
/// names each database, so no pool opens per database.
#[tauri::command]
pub async fn browse_mysql_table(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    table: String,
    joins: Option<Vec<TableJoin>>,
    filters: Option<Vec<ColumnFilter>>,
    order_by: Option<String>,
    order_table: Option<usize>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<SqlQueryResult, AppError> {
    let pool = ctx.mysql_pool(&id, None).await?;
    let order = order_by.map(|column| ColumnRef { table: order_table.unwrap_or(0), column });
    let (joins, filters) = (joins.unwrap_or_default(), filters.unwrap_or_default());
    mysql_browse(&pool, &database, &table, &joins, &filters, order.as_ref(), descending, limit, offset).await
}

pub(crate) async fn mysql_count(pool: &MySqlPool, database: &str, table: &str, joins: &[TableJoin], filters: &[ColumnFilter]) -> Result<i64, AppError> {
    // Column types are only needed, and so only fetched, when there is something to filter.
    let tables = if filters.is_empty() { Vec::new() } else { tables_columns(pool, database, table, joins).await? };
    let (from_where, binds) = from_where(database, table, joins, filters, &tables)?;
    let mut query = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) {from_where}")));
    for bind in binds {
        query = query.bind(bind);
    }
    query.fetch_one(pool).await.map_err(AppError::MySql)
}

/// The row count `browse_mysql_table`'s paging reads, joins included, asked for
/// separately so turning a page doesn't count the table again.
#[tauri::command]
pub async fn count_mysql_table(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    table: String,
    joins: Option<Vec<TableJoin>>,
    filters: Option<Vec<ColumnFilter>>,
) -> Result<i64, AppError> {
    let pool = ctx.mysql_pool(&id, None).await?;
    mysql_count(&pool, &database, &table, &joins.unwrap_or_default(), &filters.unwrap_or_default()).await
}

#[cfg(test)]
#[path = "browse.test.rs"]
mod tests;
