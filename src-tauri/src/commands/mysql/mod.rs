//! MySQL's commands, over `sqlx`, resolving a pool through `ctx.mysql_pool`.
use crate::error::AppError;

pub(super) use super::AppContext;

pub mod activity;
pub mod browse;
pub mod cancel;
mod cell;
pub mod explain;
pub mod grants;
pub mod query;
pub mod read_select;
pub mod routines;
pub mod row_history;
pub mod row_write;
mod script;
pub mod schema;
pub mod serverinfo;
pub mod transfer;
pub mod transaction;
pub mod users;

pub use activity::*;
pub use browse::*;
pub use cancel::*;
pub use explain::*;
pub use grants::*;
pub use query::*;
pub use read_select::*;
pub use routines::*;
pub use row_history::*;
pub use row_write::*;
pub use schema::*;
pub use serverinfo::*;
pub use transfer::*;
pub use transaction::*;
pub use users::*;

/// Backtick-quotes a database, table or column name, doubling any backtick inside it. A
/// bound value can never stand for a name, so every name spliced into SQL comes through here.
pub(super) fn quote_name(name: &str) -> Result<String, AppError> {
    if name.is_empty() {
        return Err(AppError::Validation(String::from("Expected a non-empty name.")));
    }
    Ok(format!("`{}`", name.replace('`', "``")))
}

/// Single-quotes a string, doubling any quote and backslash inside it, for the account
/// statements, which take no bound value for an account name or a password. A backslash
/// escapes because every session clears NO_BACKSLASH_ESCAPES (mysql/session.rs).
pub(super) fn quote_string(text: &str) -> String {
    format!("'{}'", text.replace('\\', "\\\\").replace('\'', "''"))
}

/// An account, `user@host`, as the account statements name it.
pub(super) fn quote_account(user: &str, host: &str) -> String {
    format!("{}@{}", quote_string(user), quote_string(host))
}

#[cfg(test)]
#[path = "mysql.test.rs"]
mod tests;
