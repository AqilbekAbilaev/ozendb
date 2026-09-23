use crate::error::AppError;
use crate::storage::ConnectionConfig;
use sqlx::postgres::{PgConnectOptions, PgSslMode};

const DEFAULT_DATABASE: &str = "postgres";
const DEFAULT_PORT: u16 = 5432;

/// Builds sqlx's typed connect-options from a stored `ConnectionConfig` plus the
/// password fetched separately from the OS keychain — the same split `uri::build_uri`
/// uses for MongoDB. Structured options rather than a connection string, since
/// `PgConnectOptions` already handles its own escaping.
pub fn build_options(config: &ConnectionConfig, password: Option<&str>) -> PgConnectOptions {
    let (host, port) = match config.hosts.first() {
        Some(entry) => (entry.host.clone(), entry.port),
        None => (String::from("localhost"), DEFAULT_PORT),
    };
    options_for(config, password, &host, port)
}

/// Like `build_options` but targets an explicit `host:port` (an SSH tunnel's local
/// forwarded port) instead of the config's own host list.
pub fn build_options_to(
    config: &ConnectionConfig,
    password: Option<&str>,
    host: &str,
    port: u16,
) -> PgConnectOptions {
    options_for(config, password, host, port)
}

fn options_for(
    config: &ConnectionConfig,
    password: Option<&str>,
    host: &str,
    port: u16,
) -> PgConnectOptions {
    let database = config
        .database
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_DATABASE);

    // `PgConnectOptions::new()` seeds itself from the `PG*` environment variables and
    // (via `apply_pgpass`) the `~/.pgpass` file — libpq's usual fallbacks. A desktop
    // app must not let a saved connection silently pick up credentials from whatever
    // shell environment it happened to launch in, so this starts from
    // `new_without_pgpass()` (skips the pgpass file) and then sets username/password
    // unconditionally — including to empty when the config/keychain has none — rather
    // than leaving an env-sourced value in place by only setting them when present.
    let mut options = PgConnectOptions::new_without_pgpass()
        .host(host)
        .port(port)
        .database(database)
        .username(config.username.as_deref().unwrap_or(""))
        .password(password.unwrap_or(""));

    if config.tls {
        options = options.ssl_mode(PgSslMode::Require);
        if let Some(ca) = config.tls_ca_file.as_deref().filter(|s| !s.is_empty()) {
            options = options.ssl_root_cert(ca);
        }
    }

    options
}

/// Performs an async TCP probe against the options' host:port, the same way
/// `uri::tcp_probe` does for a MongoDB URI — see `uri::probe_host_port` for the
/// shared DNS/timeout/retry core.
pub async fn tcp_probe(options: &PgConnectOptions) -> Result<(), AppError> {
    let host_port = format!("{}:{}", options.get_host(), options.get_port());
    crate::uri::probe_host_port(&host_port).await
}

#[cfg(test)]
#[path = "pg_uri.test.rs"]
mod tests;
