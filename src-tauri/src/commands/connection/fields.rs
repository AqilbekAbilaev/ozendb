use crate::error::AppError;
use crate::storage::{ConnectionConfig, EngineConfig, HostEntry, MongoConfig, PostgresConfig};

/// The connection editor's form, exactly as the frontend sends it. `save_connection`
/// and `update_connection` take the same payload; the fields the editor doesn't own
/// (id, folder, last_accessed, open) are supplied by the caller instead.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFields {
    pub name: String,
    #[serde(flatten)]
    pub engine: EngineFields,
    pub hosts: Vec<HostEntry>,
    pub username: Option<String>,
    pub tls: bool,
    pub tls_ca_file: Option<String>,
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

/// Each driver's own form fields, picked by the payload's `engine` key. A missing or
/// unknown engine fails to deserialize rather than defaulting to a driver.
#[derive(serde::Deserialize)]
#[serde(tag = "engine")]
pub enum EngineFields {
    #[serde(rename = "mongodb")]
    Mongo(MongoFields),
    #[serde(rename = "postgresql", alias = "postgres")]
    Postgres(PostgresFields),
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MongoFields {
    pub connection_type: String,
    pub replica_set_name: Option<String>,
    pub auth_db: Option<String>,
    pub auth_mechanism: Option<String>,
    pub options: std::collections::BTreeMap<String, String>,
    pub tls_cert_key_file: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostgresFields {
    #[serde(default)]
    pub database: Option<String>,
}

impl ConnectionFields {
    /// The stored config this form describes. `folder_id`/`last_accessed`/`open`
    /// come from the caller either way (new: invented; edit: preserved). An edit can
    /// change a driver's settings, never which driver they belong to: a form for a
    /// different engine than `existing` is refused.
    pub(super) fn into_config(
        self,
        id: String,
        existing: Option<&ConnectionConfig>,
        folder_id: Option<String>,
        last_accessed: Option<String>,
        open: bool,
    ) -> Result<ConnectionConfig, AppError> {
        let engine = match (self.engine, existing.map(|record| &record.engine)) {
            (EngineFields::Mongo(mongo), None | Some(EngineConfig::Mongo(_))) => {
                EngineConfig::Mongo(MongoConfig {
                    connection_type: mongo.connection_type,
                    replica_set_name: mongo.replica_set_name,
                    auth_db: mongo.auth_db,
                    auth_mechanism: mongo.auth_mechanism,
                    options: mongo.options,
                    tls_cert_key_file: mongo.tls_cert_key_file,
                })
            }
            // A blank database keeps whatever the record already had.
            (EngineFields::Postgres(postgres), stored @ (None | Some(EngineConfig::Postgres(_)))) => {
                let stored_database = stored
                    .and_then(|config| config.as_postgres())
                    .and_then(|config| config.database.clone());
                EngineConfig::Postgres(PostgresConfig {
                    database: postgres.database.or(stored_database),
                })
            }
            _ => {
                return Err(AppError::Validation(
                    "A saved connection can't change engine.".to_string(),
                ))
            }
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
