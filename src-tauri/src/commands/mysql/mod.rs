//! MySQL's commands, over `sqlx`, resolving a pool through `ctx.mysql_pool`.
use crate::error::AppError;

pub(super) use super::AppContext;

pub mod browse;
mod cell;
pub mod schema;

pub use browse::*;
pub use schema::*;

/// Backtick-quotes a database, table or column name, doubling any backtick inside it. A
/// bound value can never stand for a name, so every name spliced into SQL comes through here.
pub(super) fn quote_name(name: &str) -> Result<String, AppError> {
    if name.is_empty() {
        return Err(AppError::Validation(String::from("Expected a non-empty name.")));
    }
    Ok(format!("`{}`", name.replace('`', "``")))
}

#[cfg(test)]
#[path = "mysql.test.rs"]
mod tests;
