use crate::error::AppError;
use crate::storage::{ConnectionConfig, Engine, EngineConfig, HostEntry, MongoConfig, PostgresConfig};

/// The connection editor's form, exactly as the frontend sends it. `save_connection`
/// and `update_connection` take the same payload; the fields the editor doesn't own
/// (id, folder, last_accessed, open) are supplied by the caller instead.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFields {
    pub name: String,
    #[serde(default)]
    pub engine: Option<String>,
    // Not yet sent either (relational engines have no editor UI yet); see
    // `PostgresConfig::database`'s doc comment for what it's for.
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
fn resolve_engine(raw: Option<&str>) -> Result<Engine, AppError> {
    match raw.filter(|s| !s.is_empty()) {
        None | Some("mongodb") => Ok(Engine::Mongo),
        Some("postgresql") | Some("postgres") => Ok(Engine::Postgres),
        Some(other) => Err(AppError::Validation(format!("Unknown connection engine \"{other}\"."))),
    }
}

impl ConnectionFields {
    /// The stored config this form describes. `folder_id`/`last_accessed`/`open`
    /// come from the caller either way (new: invented; edit: preserved).
    /// `existing` likewise decides which *driver* this is — never the form's
    /// `engine`, even once the editor sends one. An edit can change a driver's
    /// settings, never which driver they belong to. Deliberate, and pinned by
    /// `into_config_ignores_a_form_supplied_engine_when_editing` in
    /// `commands/connection.test.rs`: don't delete that test without deciding, on
    /// purpose, to let edits switch engines.
    pub(super) fn into_config(
        self,
        id: String,
        existing: Option<&ConnectionConfig>,
        folder_id: Option<String>,
        last_accessed: Option<String>,
        open: bool,
    ) -> Result<ConnectionConfig, AppError> {
        let engine = match existing {
            Some(record) => record.engine_kind(),
            None => resolve_engine(self.engine.as_deref())?,
        };
        let engine = match engine {
            Engine::Mongo => EngineConfig::Mongo(MongoConfig {
                connection_type: self.connection_type,
                replica_set_name: self.replica_set_name,
                auth_db: self.auth_db,
                auth_mechanism: self.auth_mechanism,
                options: self.options,
                tls_cert_key_file: self.tls_cert_key_file,
            }),
            // The editor has no database field yet, so a `None` from the form keeps
            // whatever the record already had rather than blanking it; once the
            // editor does send one, the form wins like every other setting.
            Engine::Postgres => EngineConfig::Postgres(PostgresConfig {
                database: self.database.or_else(|| {
                    existing
                        .and_then(|record| record.engine.as_postgres())
                        .and_then(|postgres| postgres.database.clone())
                }),
            }),
        };
        Ok(ConnectionConfig {
            id: id,
            name: self.name,
            engine: engine,
            hosts: self.hosts,
            username: self.username,
            tls: self.tls,
            tls_ca_file: self.tls_ca_file,
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
