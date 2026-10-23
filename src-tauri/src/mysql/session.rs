//! What every MySQL session runs before its first query. sqlx's MySQL connect options
//! take no session variables, unlike PostgreSQL's, so the pool and Test Connection both
//! set them here on each new connection.

use sqlx::mysql::MySqlConnection;

/// The same five minutes as PostgreSQL's `statement_timeout`, in milliseconds.
const MAX_EXECUTION_TIME_MS: u32 = 300_000;

/// The one `SET` a new session runs. `max_execution_time` caps read-only `SELECT`s only:
/// MySQL has no time limit for a write. A `read_only` connection is enforced on the
/// server, as PostgreSQL's is, so a write is refused whatever SQL it came from.
// MariaDB names the time limit `max_statement_time`, in seconds, and would refuse this.
// NO_BACKSLASH_ESCAPES is dropped because the filters' LIKE patterns (commands/mysql/
// browse.rs) and the SQL the table tab writes (engines/mysql/sql.js) escape with
// backslashes; a server that sets it would read them as literal text. MySQL accepts the
// empty mode or stray comma REPLACE can leave. The time zone is UTC so that a TIMESTAMP,
// stored in UTC and read in the session's zone, reads as itself: every instant once,
// even across a daylight-saving change, and marked as UTC (commands/mysql/cell.rs).
pub(crate) fn setup_statement(read_only: bool) -> String {
    let mut statement = format!(
        "SET SESSION max_execution_time = {MAX_EXECUTION_TIME_MS}, \
         SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'NO_BACKSLASH_ESCAPES', ''), \
         SESSION time_zone = '+00:00'"
    );
    if read_only {
        statement.push_str(", SESSION transaction_read_only = ON");
    }
    statement
}

pub(crate) async fn prepare(connection: &mut MySqlConnection, read_only: bool) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(sqlx::AssertSqlSafe(setup_statement(read_only))).execute(connection).await.map(drop)
}

#[cfg(test)]
#[path = "session.test.rs"]
mod tests;
