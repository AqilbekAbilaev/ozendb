use crate::error::AppError;
use crate::storage::{ConnectionConfig, PostgresConfig};
use sqlx::postgres::{PgConnectOptions, PgSslMode};

const DEFAULT_DATABASE: &str = "postgres";
pub(crate) const DEFAULT_PORT: u16 = 5432;

/// Builds sqlx's typed connect-options from a stored `ConnectionConfig` plus the
/// password fetched separately from the OS keychain — the same split `uri::build_uri`
/// uses for MongoDB. Structured options rather than a connection string, since
/// `PgConnectOptions` already handles its own escaping.
/// Five minutes: long enough for real analysis, short enough that a forgotten
/// cross join doesn't hold a connection all afternoon.
const STATEMENT_TIMEOUT_MS: &str = "300000";

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

/// `build_options`, but naming an explicit database rather than the config's own —
/// for opening a second database on the same server (#124). Host,
/// credentials, TLS and the read-only/statement-timeout options are unchanged.
pub fn build_options_for_database(
    config: &ConnectionConfig,
    postgres: &PostgresConfig,
    password: Option<&str>,
    database: &str,
) -> Result<PgConnectOptions, AppError> {
    Ok(build_options(config, postgres, password)?.database(database))
}

/// The database a config connects to absent an override — what `options_for`
/// resolves internally, exposed so `ConnectionPool` can key its per-database pool
/// cache by the same name `build_options` would actually use.
pub(crate) fn resolved_database(postgres: &PostgresConfig) -> &str {
    postgres.database.as_deref().filter(|s| !s.is_empty()).unwrap_or(DEFAULT_DATABASE)
}

/// `build_options_to`'s sibling, for the same reason.
pub fn build_options_to_for_database(
    config: &ConnectionConfig,
    postgres: &PostgresConfig,
    password: Option<&str>,
    host: &str,
    port: u16,
    database: &str,
) -> Result<PgConnectOptions, AppError> {
    Ok(build_options_to(config, postgres, password, host, port)?.database(database))
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

    // A `read_only` connection is enforced server-side, not just by which pool
    // method a command happens to call: `run_pg_query` executes arbitrary
    // caller-supplied SQL wrapped in a subquery, which stops statements that
    // can't live in a FROM clause but not a volatile function usable inside a
    // SELECT (`nextval`, `setval`, `pg_terminate_backend`, …). Every session on
    // this connection starts its (implicit or explicit) transaction read-only,
    // so the server itself rejects any write attempt, guessed-around or not.
    // Every statement is capped server-side, so a runaway query stops even where the
    // UI has no Cancel (the table browse and count). Milliseconds.
    options = options.options([("statement_timeout", STATEMENT_TIMEOUT_MS)]);
    if config.read_only {
        options = options.options([("default_transaction_read_only", "on")]);
    }

    Ok(options)
}

/// The saved connection as a `postgresql://` string, for Copy URI: the same host, database
/// and TLS mode `build_options` connects with, but never the password — that stays in
/// the keychain, as it does for MongoDB's.
pub fn connection_string(config: &ConnectionConfig, postgres: &PostgresConfig) -> String {
    use crate::uri::percent_encode;
    let (host, port) = match config.hosts.first() {
        Some(entry) => (entry.host.as_str(), entry.port),
        None => ("localhost", DEFAULT_PORT),
    };
    let host = if host.contains(':') { format!("[{host}]") } else { host.to_string() };
    let user = match config.username.as_deref().filter(|s| !s.is_empty()) {
        Some(user) => format!("{}@", percent_encode(user)),
        None => String::new(),
    };
    let database = postgres.database.as_deref().filter(|s| !s.is_empty()).unwrap_or(DEFAULT_DATABASE);
    let mode = match (config.tls, config.tls_allow_invalid_certificates) {
        (false, _) => "disable",
        (true, true) => "require",
        (true, false) => "verify-full",
    };
    let mut uri = format!("postgresql://{user}{host}:{port}/{}?sslmode={mode}", percent_encode(database));
    if let Some(ca) = config.tls_ca_file.as_deref().filter(|s| config.tls && !s.is_empty()) {
        uri.push_str(&format!("&sslrootcert={}", percent_encode(ca)));
    }
    uri
}

/// Performs an async TCP probe against the options' host:port, the same way
/// `uri::tcp_probe` does for a MongoDB URI — see `uri::probe_host_port` for the
/// shared DNS/timeout/retry core.
pub async fn tcp_probe(options: &PgConnectOptions) -> Result<(), AppError> {
    let host_port = format!("{}:{}", options.get_host(), options.get_port());
    crate::uri::probe_host_port(&host_port).await
}

#[cfg(test)]
#[path = "uri.test.rs"]
mod tests;
