use crate::error::AppError;
use crate::storage::{ConnectionConfig, PostgresConfig};
use sqlx::postgres::{PgConnectOptions, PgSslMode};

const DEFAULT_DATABASE: &str = "postgres";
pub(crate) const DEFAULT_PORT: u16 = 5432;

/// Builds sqlx's typed connect-options from a stored `ConnectionConfig` plus the
/// password fetched separately from the OS keychain — the same split `uri::build_uri`
/// uses for MongoDB. Structured options rather than a connection string, since
/// `PgConnectOptions` already handles its own escaping.
pub fn build_options(config: &ConnectionConfig, postgres: &PostgresConfig, password: Option<&str>) -> Result<PgConnectOptions, AppError> {
    let (host, port) = match config.hosts.first() {
        Some(entry) => (entry.host.clone(), entry.port),
        None => (String::from("localhost"), DEFAULT_PORT),
    };
    options_for(config, postgres, password, &host, port)
}

/// Like `build_options` but targets an explicit `host:port` (an SSH tunnel's local
/// forwarded port) instead of the config's own host list.
pub fn build_options_to(
    config: &ConnectionConfig,
    postgres: &PostgresConfig,
    password: Option<&str>,
    host: &str,
    port: u16,
) -> Result<PgConnectOptions, AppError> {
    options_for(config, postgres, password, host, port)
}

fn options_for(
    config: &ConnectionConfig,
    postgres: &PostgresConfig,
    password: Option<&str>,
    host: &str,
    port: u16,
) -> Result<PgConnectOptions, AppError> {
    let database = postgres
        .database
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_DATABASE);

    // Postgres has no "no user" concept — an empty username is always rejected by
    // the server (`FATAL: role "" does not exist`), so this is caught here with a
    // clear message rather than left to fail confusingly inside the driver. This is
    // also why username is required rather than silently falling back to
    // `new_without_pgpass()`'s own `PGUSER`/OS-user default: that default is exactly
    // the ambient-environment leakage the rest of this function refuses.
    let username = match config.username.as_deref().filter(|s| !s.is_empty()) {
        Some(user) => user,
        None => {
            return Err(AppError::Validation(
                "PostgreSQL connections require a username.".to_string(),
            ))
        }
    };

    // `PgConnectOptions::new()` seeds itself from the `PG*` environment variables and
    // (via `apply_pgpass`) the `~/.pgpass` file — libpq's usual fallbacks. A desktop
    // app must not let a saved connection silently pick up credentials — or TLS
    // settings — from whatever shell environment it happened to launch in, so this
    // starts from `new_without_pgpass()` (skips the pgpass file) and then sets
    // every security-relevant field unconditionally below, rather than leaving an
    // env-sourced value in place by only setting a field when the config has one.
    let mut options = PgConnectOptions::new_without_pgpass()
        .host(host)
        .port(port)
        .database(database)
        .username(username)
        .password(password.unwrap_or(""));

    // `Require` only encrypts — per sqlx's own `maybe_upgrade`, it does not verify
    // the server certificate or hostname (only `VerifyCa`/`VerifyFull` do), despite
    // what the mode's doc comment implies. So `tls: true` defaults to `VerifyFull`
    // (verified against this crate's bundled webpki roots, plus any CA below);
    // `tls_allow_invalid_certificates` is the explicit, opt-in escape hatch to the
    // unverified `Require`. A configured CA does *not* drop this to `VerifyCa`: sqlx
    // adds a configured `ssl_root_cert` to the imported root store rather than
    // replacing it, so `VerifyFull` + a custom CA still verifies the hostname too —
    // silently trading that away just because a CA was given would be a real (if
    // narrower) version of this same weakening, for anyone whose internal CA's certs
    // happen to carry a matching hostname.
    let ca_file = config.tls_ca_file.as_deref().filter(|s| !s.is_empty());
    let ssl_mode = if !config.tls {
        PgSslMode::Disable
    } else if config.tls_allow_invalid_certificates {
        PgSslMode::Require
    } else {
        PgSslMode::VerifyFull
    };
    options = options.ssl_mode(ssl_mode);
    options = match ca_file {
        Some(ca) => options.ssl_root_cert(ca),
        // Explicit empty override, the same reasoning as username/password above —
        // sqlx's own doc example for `ssl_root_cert_from_pem` recommends exactly
        // this for "no additional CA" rather than leaving an ambient `PGSSLROOTCERT`
        // file path in place.
        None => options.ssl_root_cert_from_pem(Vec::new()),
    };

    Ok(options)
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
