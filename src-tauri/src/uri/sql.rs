use super::percent_encode;
use crate::storage::ConnectionConfig;

/// How one SQL engine spells its connection string: everything that differs between
/// PostgreSQL's and MySQL's.
pub(crate) struct SqlUriFormat {
    pub scheme: &'static str,
    pub default_port: u16,
    pub mode_param: &'static str,
    /// The TLS modes for: off, encrypted without verifying, and verifying the server and
    /// its hostname.
    pub modes: [&'static str; 3],
    pub ca_param: &'static str,
}

/// The saved connection as a SQL connection string, for Copy URI, never with the password:
/// that stays in the keychain. The caller has already decided how an absent database is
/// written, since PostgreSQL names its default one and MySQL leaves it blank.
pub(crate) fn connection_string(config: &ConnectionConfig, database: &str, format: &SqlUriFormat) -> String {
    let (host, port) = match config.hosts.first() {
        Some(entry) => (entry.host.as_str(), entry.port),
        None => ("localhost", format.default_port),
    };
    let host = bracketed(host);
    let user = match config.username.as_deref().filter(|s| !s.is_empty()) {
        Some(user) => format!("{}@", percent_encode(user)),
        None => String::new(),
    };
    let [off, unverified, verified] = format.modes;
    let mode = match (config.tls, config.tls_allow_invalid_certificates) {
        (false, _) => off,
        (true, true) => unverified,
        (true, false) => verified,
    };
    let mut uri = format!("{}://{user}{host}:{port}/{}?{}={mode}", format.scheme, percent_encode(database), format.mode_param);
    if let Some(ca) = config.tls_ca_file.as_deref().filter(|s| config.tls && !s.is_empty()) {
        uri.push_str(&format!("&{}={}", format.ca_param, percent_encode(ca)));
    }
    uri
}

/// `host` as it is written before a `:port`, with an IPv6 address in brackets.
pub(crate) fn bracketed(host: &str) -> String {
    if host.contains(':') { format!("[{host}]") } else { host.to_string() }
}

#[cfg(test)]
#[path = "sql.test.rs"]
mod tests;
