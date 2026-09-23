use crate::error::AppError;
use crate::pg_uri;
use crate::storage::ConnectionConfig;
use sqlx::Connection as _;

/// The Postgres half of `test_connection`, split out the way `ssh.rs` holds the
/// SSH-tunnel half — a single ephemeral connection (never touching `ctx.pool`, so a
/// failed test leaves nothing cached), mirroring the Mongo path's ad-hoc `Client`.
pub(super) async fn test_postgres_connection(
    config: &ConnectionConfig,
    password: Option<&str>,
) -> Result<(), AppError> {
    let options = pg_uri::build_options(config, password);

    match pg_uri::tcp_probe(&options).await {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    match sqlx::postgres::PgConnection::connect_with(&options).await {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::Postgres(e)),
    }
}
