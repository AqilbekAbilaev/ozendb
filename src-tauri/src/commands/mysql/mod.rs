//! MySQL's commands, over `sqlx`, resolving a pool through `ctx.mysql_pool`.

pub(super) use super::AppContext;

pub mod schema;

pub use schema::*;
