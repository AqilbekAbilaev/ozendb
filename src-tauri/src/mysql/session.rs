//! What every MySQL session runs before its first query. sqlx's MySQL connect options
//! take no session variables, unlike PostgreSQL's, so the pool and Test Connection both
//! set them here on each new connection.

use sqlx::mysql::MySqlConnection;

/// The same five minutes as PostgreSQL's `statement_timeout`, in milliseconds.
const MAX_EXECUTION_TIME_MS: u32 = 300_000;

/// That limit for every statement the SQL tab runs, a write included: the app stops one
/// that runs past it (commands/mysql/cancel.rs).
pub(crate) const QUERY_TIME_LIMIT: std::time::Duration = std::time::Duration::from_millis(MAX_EXECUTION_TIME_MS as u64);

/// What makes a session read-only, which the SQL tab runs again before each statement on
/// a read-only connection (commands/mysql/query.rs). The one form both MySQL and every
/// MariaDB version accept; MariaDB 10 has no `transaction_read_only` variable.
pub(crate) const READ_ONLY_LOCK: &str = "SET SESSION TRANSACTION READ ONLY";

/// Which server family a connection reached, since MySQL and MariaDB name some session
/// settings differently.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Flavor {
    MySql,
    MariaDb,
}

impl Flavor {
    /// The family of a server reporting `version` (`SELECT VERSION()`).
    pub(crate) fn of(version: &str) -> Flavor {
        if version.contains("MariaDB") {
            Flavor::MariaDb
        } else {
            Flavor::MySql
        }
    }
}

/// The family of the server `connection` reached.
pub(crate) async fn flavor(connection: &mut MySqlConnection) -> Result<Flavor, sqlx::Error> {
    sqlx::query_scalar::<_, String>("SELECT VERSION()").fetch_one(connection).await.map(|version| Flavor::of(&version))
}

/// What lifts the session's time limit, for work that may run long, such as an export.
pub(crate) fn unlimited(flavor: Flavor) -> &'static str {
    match flavor {
        Flavor::MySql => "SET SESSION max_execution_time = 0",
        Flavor::MariaDb => "SET SESSION max_statement_time = 0",
    }
}

/// What a new session runs. MySQL's `max_execution_time` caps read-only `SELECT`s only,
/// in milliseconds; MariaDB's `max_statement_time` caps every statement, in seconds. A
/// `read_only` connection is enforced on the server, as PostgreSQL's is, so a write is
/// refused whatever SQL it came from.
// NO_BACKSLASH_ESCAPES is dropped because the filters' LIKE patterns (commands/mysql/
// browse.rs) and the SQL the table tab writes (engines/mysql/sql.js) escape with
// backslashes; a server that sets it would read them as literal text. MySQL accepts the
// empty mode or stray comma REPLACE can leave. The time zone is UTC so that a TIMESTAMP,
// stored in UTC and read in the session's zone, reads as itself: every instant once,
// even across a daylight-saving change, and marked as UTC (commands/mysql/cell.rs).
pub(crate) fn setup_statement(flavor: Flavor, read_only: bool) -> String {
    let limit = match flavor {
        Flavor::MySql => format!("max_execution_time = {MAX_EXECUTION_TIME_MS}"),
        Flavor::MariaDb => format!("max_statement_time = {}", MAX_EXECUTION_TIME_MS / 1000),
    };
    let mut statement = format!(
        "SET SESSION {limit}, \
         SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'NO_BACKSLASH_ESCAPES', ''), \
         SESSION time_zone = '+00:00'"
    );
    if read_only {
        statement.push_str("; ");
        statement.push_str(READ_ONLY_LOCK);
    }
    statement
}

pub(crate) async fn prepare(connection: &mut MySqlConnection, read_only: bool) -> Result<(), sqlx::Error> {
    let flavor = flavor(connection).await?;
    sqlx::raw_sql(sqlx::AssertSqlSafe(setup_statement(flavor, read_only))).execute(connection).await.map(drop)
}

#[cfg(test)]
#[path = "session.test.rs"]
mod tests;
