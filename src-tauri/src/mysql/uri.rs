use crate::error::AppError;
use crate::storage::{ConnectionConfig, MySqlConfig};
use crate::uri::sql::{self, SqlUriFormat};
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};

pub(crate) const DEFAULT_PORT: u16 = 3306;

const URI_FORMAT: SqlUriFormat = SqlUriFormat {
    scheme: "mysql",
    default_port: DEFAULT_PORT,
    mode_param: "ssl-mode",
    modes: ["DISABLED", "REQUIRED", "VERIFY_IDENTITY"],
    ca_param: "ssl-ca",
};

/// The database a config opens absent an override. Empty means none: unlike PostgreSQL,
/// a MySQL session needs no default database, and every query can name its own.
pub(crate) fn own_database(mysql: &MySqlConfig) -> &str {
    mysql.database.as_deref().unwrap_or_default()
}

/// sqlx's typed connect-options for a saved connection, with the password read from the
/// keychain separately, as PostgreSQL's `build_options` does. `via` is the local port of
/// an SSH tunnel, which is dialled instead of the config's first host.
pub fn build_options(
    config: &ConnectionConfig,
    password: Option<&str>,
    database: &str,
    via: Option<u16>,
) -> Result<MySqlConnectOptions, AppError> {
    let (host, port) = match (via, config.hosts.first()) {
        (Some(port), _) => (String::from("127.0.0.1"), port),
        (None, Some(entry)) => (entry.host.clone(), entry.port),
        (None, None) => (String::from("localhost"), DEFAULT_PORT),
    };
    // sqlx would otherwise log in as `root`, which is never what a blank field meant.
    let Some(username) = config.username.as_deref().filter(|s| !s.is_empty()) else {
        return Err(AppError::Validation("MySQL connections require a username.".to_string()));
    };
    let mut options = MySqlConnectOptions::new().host(&host).port(port).username(username);
    if let Some(password) = password {
        options = options.password(password);
    }
    if !database.is_empty() {
        options = options.database(database);
    }

    // The same reading as PostgreSQL's, and as `connection_string` reports it: `Required`
    // only encrypts, so TLS verifies the certificate and hostname unless invalid
    // certificates are explicitly allowed. A CA file is added to the trusted roots.
    let ssl_mode = if !config.tls {
        MySqlSslMode::Disabled
    } else if config.tls_allow_invalid_certificates {
        MySqlSslMode::Required
    } else {
        MySqlSslMode::VerifyIdentity
    };
    options = options.ssl_mode(ssl_mode);
    if let Some(ca) = config.tls_ca_file.as_deref().filter(|s| !s.is_empty()) {
        options = options.ssl_ca(ca);
    }
    Ok(options)
}

/// The saved connection as a `mysql://` string, for Copy URI. TLS reads as PostgreSQL's
/// does, verifying the server and its hostname unless invalid certificates are explicitly
/// allowed.
pub fn connection_string(config: &ConnectionConfig, mysql: &MySqlConfig) -> String {
    sql::connection_string(config, own_database(mysql), &URI_FORMAT)
}

/// A quick TCP probe of the options' host and port, so an unreachable server fails fast
/// with a clear message rather than after the driver's own timeout.
pub async fn tcp_probe(options: &MySqlConnectOptions) -> Result<(), AppError> {
    let host_port = format!("{}:{}", crate::uri::sql::bracketed(options.get_host()), options.get_port());
    crate::uri::probe_host_port(&host_port).await
}

#[cfg(test)]
#[path = "uri.test.rs"]
mod tests;
