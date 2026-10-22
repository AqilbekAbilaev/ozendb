use crate::storage::{ConnectionConfig, MySqlConfig};
use crate::uri::sql::{self, SqlUriFormat};

pub(crate) const DEFAULT_PORT: u16 = 3306;

const URI_FORMAT: SqlUriFormat = SqlUriFormat {
    scheme: "mysql",
    default_port: DEFAULT_PORT,
    mode_param: "ssl-mode",
    modes: ["DISABLED", "REQUIRED", "VERIFY_IDENTITY"],
    ca_param: "ssl-ca",
};

/// The saved connection as a `mysql://` string, for Copy URI. TLS reads as PostgreSQL's
/// does, verifying the server and its hostname unless invalid certificates are explicitly
/// allowed.
pub fn connection_string(config: &ConnectionConfig, mysql: &MySqlConfig) -> String {
    sql::connection_string(config, mysql.database.as_deref().unwrap_or_default(), &URI_FORMAT)
}

#[cfg(test)]
#[path = "uri.test.rs"]
mod tests;
