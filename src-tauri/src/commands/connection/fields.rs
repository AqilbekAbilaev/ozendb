use crate::error::AppError;
use crate::storage::{ConnectionConfig, HostEntry};

/// The connection editor's form, exactly as the frontend sends it. `save_connection`
/// and `update_connection` take the same payload; the fields the editor doesn't own
/// (id, folder, last_accessed, open) are supplied by the caller instead.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFields {
    pub name: String,
    // Not yet sent by the connection editor (MongoDB is still the only engine it
    // offers), so this defaults to absent rather than being a required field —
    // `into_config` treats a missing/empty value as `"mongodb"`.
    #[serde(default)]
    pub engine: Option<String>,
    // Not yet sent either (relational engines have no editor UI yet); see
    // `ConnectionConfig::database`'s doc comment for what it's for.
    #[serde(default)]
    pub database: Option<String>,
    pub hosts: Vec<HostEntry>,
    pub connection_type: String,
    pub replica_set_name: Option<String>,
    pub username: Option<String>,
    pub auth_db: Option<String>,
    pub auth_mechanism: Option<String>,
    pub options: std::collections::BTreeMap<String, String>,
    pub tls: bool,
    pub tls_ca_file: Option<String>,
    pub tls_cert_key_file: Option<String>,
    pub tls_allow_invalid_certificates: bool,
    pub ssh_enabled: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: u16,
    pub ssh_user: Option<String>,
    pub ssh_auth: Option<String>,
    pub ssh_key_file: Option<String>,
    pub tag: Option<String>,
    pub read_only: bool,
    // Secrets ride in the same payload but have no place in `ConnectionConfig` —
    // they go to the keychain and nowhere else.
    pub password: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_passphrase: Option<String>,
}

/// Canonicalizes and validates a form-supplied `engine` value. `None`/empty means
/// the connection editor hasn't offered a choice yet (true for every connection
/// today) and defaults to `mongodb`; an explicit value must be a driver this app
/// actually knows how to dial. Unlike `ConnectionKind::from_str`'s permissive
/// fallback — an unrecognized `connection_type` just picks a topology default —
/// an unrecognized *engine* would silently pick the wrong driver, so this rejects
/// rather than guesses.
fn resolve_engine(raw: Option<&str>) -> Result<String, AppError> {
    match raw.filter(|s| !s.is_empty()) {
        None | Some("mongodb") => Ok(String::from("mongodb")),
        Some("postgresql") | Some("postgres") => Ok(String::from("postgresql")),
        Some(other) => Err(AppError::Validation(format!("Unknown connection engine \"{other}\"."))),
    }
}

impl ConnectionFields {
    /// The stored config this form describes. `folder_id`/`last_accessed`/`open`
    /// come from the caller the same way regardless: a new connection invents them,
    /// an edit preserves the existing record's. `existing` drives `engine`/
    /// `database` the same way — `None` for a new connection (so they come from the
    /// form, defaulting to MongoDB) and `Some(&record)` for an edit, since the
    /// editor doesn't carry either field yet and letting an edit silently default
    /// them back to MongoDB would re-point a saved Postgres connection at the wrong
    /// driver.
    pub(super) fn into_config(
        self,
        id: String,
        existing: Option<&ConnectionConfig>,
        folder_id: Option<String>,
        last_accessed: Option<String>,
        open: bool,
    ) -> Result<ConnectionConfig, AppError> {
        let (engine, database) = match existing {
            Some(record) => (record.engine.clone(), record.database.clone()),
            None => (resolve_engine(self.engine.as_deref())?, self.database),
        };
        Ok(ConnectionConfig {
            id: id,
            name: self.name,
            engine: engine,
            database: database,
            hosts: self.hosts,
            connection_type: self.connection_type,
            replica_set_name: self.replica_set_name,
            username: self.username,
            auth_db: self.auth_db,
            auth_mechanism: self.auth_mechanism,
            options: self.options,
            tls: self.tls,
            tls_ca_file: self.tls_ca_file,
            tls_cert_key_file: self.tls_cert_key_file,
            tls_allow_invalid_certificates: self.tls_allow_invalid_certificates,
            ssh_enabled: self.ssh_enabled,
            ssh_host: self.ssh_host,
            ssh_port: self.ssh_port,
            ssh_user: self.ssh_user,
            ssh_auth: self.ssh_auth,
            ssh_key_file: self.ssh_key_file,
            tag: self.tag,
            read_only: self.read_only,
            folder_id: folder_id,
            last_accessed: last_accessed,
            open: open,
        })
    }

    /// The three secrets, lifted out before `into_config` consumes the form.
    pub(super) fn secrets(&self) -> (Option<String>, Option<String>, Option<String>) {
        (
            self.password.clone(),
            self.ssh_password.clone(),
            self.ssh_passphrase.clone(),
        )
    }
}
