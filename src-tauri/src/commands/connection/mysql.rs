use crate::error::AppError;
use crate::mysql::session as mysql_session;
use crate::mysql::uri as mysql_uri;
use crate::storage::{ConnectionConfig, MySqlConfig};
use sqlx::Connection as _;

/// The MySQL half of `test_connection`: one throwaway connection, never cached in
/// `ctx.pool`, as `test_postgres_connection` does for PostgreSQL.
pub(super) async fn test_mysql_connection(
    config: &ConnectionConfig,
    mysql: &MySqlConfig,
    password: Option<&str>,
    via: Option<u16>,
) -> Result<(), AppError> {
    let options = mysql_uri::build_options(config, password, mysql_uri::own_database(mysql), via)?;
    mysql_uri::tcp_probe(&options).await?;
    let mut connection = sqlx::mysql::MySqlConnection::connect_with(&options).await.map_err(AppError::MySql)?;
    // The pool prepares every session the same way, so a server that refuses it fails here.
    // Dropped rather than closed: the login is what was tested, and a failed goodbye
    // would only turn a working connection red.
    mysql_session::prepare(&mut connection, config.read_only).await.map_err(AppError::MySql)
}
