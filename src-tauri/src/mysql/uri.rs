use crate::storage::{ConnectionConfig, MySqlConfig};
use crate::uri::percent_encode;

pub(crate) const DEFAULT_PORT: u16 = 3306;

/// The saved connection as a `mysql://` string, for Copy URI, never with the password:
/// that stays in the keychain. TLS reads as PostgreSQL's does, verifying the server and
/// its hostname unless invalid certificates are explicitly allowed.
pub fn connection_string(config: &ConnectionConfig, mysql: &MySqlConfig) -> String {
    let (host, port) = match config.hosts.first() {
        Some(entry) => (entry.host.as_str(), entry.port),
        None => ("localhost", DEFAULT_PORT),
    };
    let host = if host.contains(':') { format!("[{host}]") } else { host.to_string() };
    let user = match config.username.as_deref().filter(|s| !s.is_empty()) {
        Some(user) => format!("{}@", percent_encode(user)),
        None => String::new(),
    };
    let database = mysql.database.as_deref().unwrap_or_default();
    let mode = match (config.tls, config.tls_allow_invalid_certificates) {
        (false, _) => "DISABLED",
        (true, true) => "REQUIRED",
        (true, false) => "VERIFY_IDENTITY",
    };
    let mut uri = format!("mysql://{user}{host}:{port}/{}?ssl-mode={mode}", percent_encode(database));
    if let Some(ca) = config.tls_ca_file.as_deref().filter(|s| config.tls && !s.is_empty()) {
        uri.push_str(&format!("&ssl-ca={}", percent_encode(ca)));
    }
    uri
}

#[cfg(test)]
#[path = "uri.test.rs"]
mod tests;
