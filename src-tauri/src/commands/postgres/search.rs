//! Cross-table "Search in…" for PostgreSQL (#132) — the sibling of MongoDB's
//! `commands/search/mod.rs`, built as one `UNION ALL` query across every candidate
//! (table, text-like column) pair rather than a per-table scan: Postgres has typed,
//! fixed columns, so "every table" can't mean "every field" the way a schemaless
//! Mongo collection can, and a single query lets the existing `cancel.rs` run-id
//! mechanism and the server's own statement timeout both apply for free.
use crate::error::AppError;
use serde::Serialize;
use tauri::State;

use super::{cancel, primary_key_columns, quote_ident, AppContext};

// A convenience cap, not a hard server-side one: `statement_timeout` (pg_uri.rs)
// already bounds how long the underlying query can run.
const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 1000;

// Only `text`/`varchar`/`bpchar` ("character"/"char(n)")/`char`/`name` — a plain
// substring or regex match on a number, date or binary column isn't generally
// meaningful, and the acceptance criteria calls for this restriction to be
// explicit rather than accidental.
const TEXT_LIKE_TYPES: &str = "'text', 'varchar', 'bpchar', 'char', 'name'";

async fn text_columns(pool: &sqlx::PgPool, schema: &str, table: &str) -> Result<Vec<String>, AppError> {
    let sql = format!(
        "SELECT a.attname FROM pg_attribute a \
         JOIN pg_class c ON c.oid = a.attrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         JOIN pg_type t ON t.oid = a.atttypid \
         WHERE n.nspname = $1 AND c.relname = $2 \
             AND a.attnum > 0 AND NOT a.attisdropped \
             AND t.typname IN ({TEXT_LIKE_TYPES}) \
         ORDER BY a.attnum"
    );
    let rows: Vec<(String,)> = match sqlx::query_as(sqlx::AssertSqlSafe(sql)).bind(schema).bind(table).fetch_all(pool).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    Ok(rows.into_iter().map(|(name,)| name).collect())
}

/// Every ordinary (or partitioned) table in `schema` — views/materialized views are
/// left out, the same way `update_pg_row`'s primary-key requirement already rules
/// them out as a search target (neither can identify "which row matched" safely).
async fn tables_in_schema(pool: &sqlx::PgPool, schema: &str) -> Result<Vec<String>, AppError> {
    let rows: Vec<(String,)> = match sqlx::query_as(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') ORDER BY c.relname",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    Ok(rows.into_iter().map(|(name,)| name).collect())
}

// A single-quoted SQL string literal — for splicing a table/column *name* into the
// query text as a literal display value (never as an identifier, which always goes
// through `quote_ident` instead, and never as a bound value, since it's not caller
// input but something we already read back from the catalog).
fn sql_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgSearchMatch {
    pub table: String,
    pub column: String,
    /// The matched row's primary key as a JSON object (column -> text value) —
    /// enough to re-identify the row regardless of the key's shape or width.
    pub primary_key: serde_json::Value,
    pub value: String,
}

#[derive(Serialize)]
pub struct PgSearchResult {
    pub matches: Vec<PgSearchMatch>,
    pub truncated: bool,
    /// Tables left out of the search because they have no primary key (can't
    /// identify a matched row) or no text-like column (nothing to search) —
    /// reported so "no matches" and "nothing searchable" aren't confused.
    pub skipped: Vec<String>,
}

/// The `UNION ALL` query across every candidate table's text-like columns, and
/// which candidates were left out. Every branch shares one bound term (`$1`); the
/// caller binds `$2` as the row cap. Returns an empty SQL string when nothing in
/// `tables` is searchable at all.
async fn build_search_sql(
    pool: &sqlx::PgPool,
    schema: &str,
    tables: &[String],
    case_sensitive: bool,
    regex: bool,
) -> Result<(String, Vec<String>), AppError> {
    let quoted_schema = quote_ident(schema)?;
    let op = match (regex, case_sensitive) {
        (true, true) => "~",
        (true, false) => "~*",
        (false, true) => "LIKE",
        (false, false) => "ILIKE",
    };
    let pattern = if regex { String::from("$1") } else { String::from("'%' || $1 || '%'") };

    let mut branches = Vec::new();
    let mut skipped = Vec::new();
    for table in tables {
        let pk = primary_key_columns(pool, schema, table).await?;
        let columns = text_columns(pool, schema, table).await?;
        if pk.is_empty() || columns.is_empty() {
            skipped.push(table.clone());
            continue;
        }
        let quoted_table = quote_ident(table)?;
        let mut pk_pairs = Vec::with_capacity(pk.len());
        for col in &pk {
            pk_pairs.push(format!("{}, {}::text", sql_literal(col), quote_ident(col)?));
        }
        let pk_json = format!("jsonb_build_object({})", pk_pairs.join(", "));

        for column in &columns {
            let quoted_column = quote_ident(column)?;
            branches.push(format!(
                "SELECT {}::text AS tbl, {}::text AS col, {pk_json}::text AS pk, {quoted_column}::text AS val \
                 FROM {quoted_schema}.{quoted_table} WHERE {quoted_column}::text {op} {pattern}",
                sql_literal(table),
                sql_literal(column),
            ));
        }
    }
    if branches.is_empty() {
        return Ok((String::new(), skipped));
    }
    Ok((format!("SELECT * FROM ({}) search_union ORDER BY tbl, col LIMIT $2", branches.join(" UNION ALL ")), skipped))
}

/// Everything `search_pg_tables` does once it has a pool — split out so the live
/// integration tests (`pg_command_integration_tests.rs`) can exercise the real
/// query-building and execution without a Tauri `AppContext`, the same `*_impl`
/// split every other Postgres command in this codebase already uses.
pub(crate) async fn search_tables_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    tables: Option<Vec<String>>,
    term: &str,
    case_sensitive: bool,
    regex: bool,
    limit: Option<i64>,
    run_id: Option<&str>,
) -> Result<PgSearchResult, AppError> {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return Ok(PgSearchResult { matches: Vec::new(), truncated: false, skipped: Vec::new() });
    }
    let cap = match limit {
        Some(val) if val > 0 => val.min(MAX_LIMIT),
        _ => DEFAULT_LIMIT,
    };

    let target_tables = match tables {
        Some(val) if !val.is_empty() => val,
        _ => tables_in_schema(pool, schema).await?,
    };
    let (sql, skipped) = build_search_sql(pool, schema, &target_tables, case_sensitive, regex).await?;
    if sql.is_empty() {
        return Ok(PgSearchResult { matches: Vec::new(), truncated: false, skipped });
    }

    // ILIKE/LIKE's own wildcards, escaped so the term matches literally — the same
    // escaping `browse.rs`'s "contains" filter applies, for the same reason. A
    // regex term is bound exactly as typed; it's a pattern, not literal text.
    let bound_term = if regex {
        trimmed.to_string()
    } else {
        trimmed.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
    };

    let mut conn = match pool.acquire().await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    let _running = match run_id {
        Some(run_id) => Some(cancel::register(&mut conn, run_id).await?),
        None => None,
    };

    let rows: Vec<(String, String, String, String)> =
        match sqlx::query_as(sqlx::AssertSqlSafe(sql)).bind(&bound_term).bind(cap + 1).fetch_all(&mut *conn).await {
            Ok(val) => val,
            Err(e) => return Err(AppError::Postgres(e)),
        };

    let truncated = rows.len() as i64 > cap;
    let matches = rows
        .into_iter()
        .take(cap as usize)
        .map(|(table, column, pk_text, value)| PgSearchMatch {
            table,
            column,
            primary_key: serde_json::from_str(&pk_text).unwrap_or(serde_json::Value::Null),
            value,
        })
        .collect();

    Ok(PgSearchResult { matches, truncated, skipped })
}

/// Searches every text-like column of every table named in `tables` (or, when
/// omitted, every ordinary table in `schema`) for `term` as a substring (default)
/// or, with `regex`, a POSIX regular expression Postgres itself evaluates via `~`/
/// `~*`. `run_id` makes it cancellable through the existing `cancel_pg_query` —
/// this registers under the same run-id registry a plain query would.
#[tauri::command]
pub async fn search_pg_tables(
    ctx: State<'_, AppContext>,
    id: String,
    schema: String,
    tables: Option<Vec<String>>,
    term: String,
    match_case: Option<bool>,
    regex: Option<bool>,
    limit: Option<i64>,
    run_id: Option<String>,
) -> Result<PgSearchResult, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    search_tables_impl(&pool, &schema, tables, &term, match_case.unwrap_or(false), regex.unwrap_or(false), limit, run_id.as_deref()).await
}

#[cfg(test)]
#[path = "search.test.rs"]
mod tests;
