//! Explain: the plan MySQL chose for one statement, as `EXPLAIN FORMAT=JSON` in its
//! second version (MySQL 8.3 and later), which lists the same steps as EXPLAIN ANALYZE's
//! tree. For a statement that only reads, ANALYZE runs it and adds the real rows and
//! times; anything else is explained without running.
use std::time::Duration;

use sqlparser::ast::{Query, SetExpr, Statement};
use sqlparser::dialect::MySqlDialect;
use sqlparser::parser::Parser;
use sqlx::MySqlPool;
use tauri::State;

use super::cancel::Run;
use super::script::statements;
use super::AppContext;
use crate::error::AppError;
use crate::mysql::session::QUERY_TIME_LIMIT;

/// The whole plan MySQL gives a statement its iterators don't run, a single-table UPDATE
/// or DELETE among them.
const NOT_ITERATED: &str = "<not executable by iterator executor>";

/// Whether running `sql` can only read: one query made only of SELECTs that write into
/// neither a variable nor a file, and VALUES, its WITH included. SQL sqlparser can't
/// read doesn't count, MySQL's `TABLE t` among it.
fn only_reads(sql: &str) -> bool {
    matches!(Parser::parse_sql(&MySqlDialect {}, sql).as_deref(), Ok([Statement::Query(query)]) if reads(query))
}

fn reads(query: &Query) -> bool {
    query.with.iter().flat_map(|with| &with.cte_tables).all(|cte| reads(&cte.query)) && body_reads(&query.body)
}

/// A query's body can also be a write: sqlparser reads `WITH … DELETE` as a query.
fn body_reads(body: &SetExpr) -> bool {
    match body {
        SetExpr::Select(select) => select.into.is_none(),
        SetExpr::Query(query) => reads(query),
        SetExpr::SetOperation { left, right, .. } => body_reads(left) && body_reads(right),
        SetExpr::Values(_) => true,
        _ => false,
    }
}

/// Whether a server reporting `version` (`SELECT VERSION()`) has the second JSON format.
fn plans_in_json_v2(version: &str) -> bool {
    let mut parts = version.split(['.', '-']).map(|part| part.parse::<u32>().ok());
    matches!((parts.next().flatten(), parts.next().flatten()), (Some(major), Some(minor)) if (major, minor) >= (8, 3))
}

/// The plan for `sql`, which must be one statement, as MySQL's JSON. It runs on a session
/// of its own, closed afterwards, so the format it sets ends with it. ANALYZE runs the
/// statement inside a read-only transaction that the closing session rolls back: even a
/// stored function the SELECT calls can't write. `run_id` lets `cancel_mysql_query` stop
/// it, and nothing it does, from waiting for a session on, runs past `limit`.
pub(crate) async fn explain_mysql_sql(pool: &MySqlPool, sql: &str, read_only: bool, run_id: Option<&str>, limit: Duration) -> Result<serde_json::Value, AppError> {
    let [statement] = statements(sql, read_only)?[..] else {
        return Err(AppError::Validation(String::from("Explain shows one statement's plan; leave only the one to explain in the editor.")));
    };
    let run = Run::new(run_id);
    let started = tokio::time::Instant::now();
    let left = || limit.saturating_sub(started.elapsed());
    // No session yet to send a KILL to, so the wait for one is simply abandoned.
    let (mut conn, version, connection) = tokio::time::timeout(limit, async {
        let mut conn = pool.acquire().await.map_err(AppError::MySql)?;
        conn.close_on_drop();
        let (version, connection): (String, u64) = sqlx::query_as("SELECT VERSION(), CONNECTION_ID()").fetch_one(&mut *conn).await.map_err(AppError::MySql)?;
        Ok::<_, AppError>((conn, version, connection))
    })
    .await
    .map_err(|_| AppError::TimedOut)??;
    if !plans_in_json_v2(&version) {
        return Err(AppError::Validation(format!("Explain needs MySQL 8.3 or later; this server runs {version}.")));
    }
    let analyze = only_reads(statement);
    let setup = if analyze { "SET SESSION explain_json_format_version = 2; START TRANSACTION READ ONLY" } else { "SET SESSION explain_json_format_version = 2" };
    // `statement` is the caller's own SQL, run as-is: the same trust as run_mysql_query.
    let explain = format!("EXPLAIN {}FORMAT=JSON {statement}", if analyze { "ANALYZE " } else { "" });
    let answer: String = run
        .on(connection, async {
            run.limited(pool, left(), async { sqlx::raw_sql(setup).execute(&mut *conn).await.map_err(AppError::MySql) }).await?;
            run.limited(pool, left(), async { sqlx::query_scalar(sqlx::AssertSqlSafe(explain)).fetch_one(&mut *conn).await.map_err(AppError::MySql) }).await
        })
        .await?;
    plan(answer)
}

/// The plan in MySQL's `answer` to EXPLAIN FORMAT=JSON.
fn plan(answer: String) -> Result<serde_json::Value, AppError> {
    let plan: serde_json::Value = serde_json::from_str(&answer)?;
    if plan["operation"] == NOT_ITERATED {
        return Err(AppError::Validation(String::from("MySQL can't show this statement's plan as steps; explain a SELECT with the same WHERE instead.")));
    }
    Ok(plan)
}

/// `run_id` lets `cancel_mysql_query` stop it; `database`, when given, is the one the
/// session starts in rather than the connection's own.
#[tauri::command]
pub async fn explain_mysql_query(ctx: State<'_, AppContext>, id: String, sql: String, run_id: Option<String>, database: Option<String>) -> Result<serde_json::Value, AppError> {
    let pool = ctx.mysql_pool(&id, database.as_deref()).await?;
    explain_mysql_sql(&pool, &sql, ctx.is_read_only(&id), run_id.as_deref(), QUERY_TIME_LIMIT).await
}

#[cfg(test)]
#[path = "explain.test.rs"]
mod tests;
