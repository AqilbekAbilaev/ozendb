use crate::error::AppError;
use crate::known_hosts::KnownHostsStore;
use crate::ssh::HostKeyPrompts;
use crate::storage::{ConnectionConfig, EngineConfig, HostEntry, MongoConfig, SshAuthMethod};
use crate::uri;
use mongodb::Client;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn test_ssh_connection(
    app: tauri::AppHandle,
    known_hosts: State<'_, Arc<KnownHostsStore>>,
    prompts: State<'_, Arc<HostKeyPrompts>>,
    ssh_host: String,
    ssh_port: u16,
    ssh_user: String,
    ssh_auth: String,
    ssh_password: Option<String>,
    ssh_key_file: Option<String>,
    ssh_passphrase: Option<String>,
    mongo_host: String,
    mongo_port: u16,
    username: Option<String>,
    password: Option<String>,
    auth_db: Option<String>,
    auth_mechanism: Option<String>,
) -> Result<(), AppError> {
    let auth = match SshAuthMethod::from_opt(Some(ssh_auth.as_str())) {
        SshAuthMethod::Key => crate::ssh::SshAuth::Key {
            path: ssh_key_file.unwrap_or_default(),
            passphrase: ssh_passphrase,
        },
        SshAuthMethod::Password => crate::ssh::SshAuth::Password(ssh_password.unwrap_or_default()),
    };
    let params = crate::ssh::SshParams {
        ssh_host, ssh_port, ssh_user, auth, mongo_host: mongo_host.clone(), mongo_port,
    };
    let tunnel = crate::ssh::establish(
        params, Arc::clone(known_hosts.inner()), Arc::clone(prompts.inner()), app,
    ).await?;
    let cfg = ConnectionConfig {
        id: String::new(), name: String::new(),
        hosts: vec![HostEntry { host: mongo_host, port: mongo_port }],
        username,
        engine: EngineConfig::Mongo(MongoConfig {
            connection_type: String::from("standalone"), replica_set_name: None,
            auth_db, auth_mechanism,
            options: std::collections::BTreeMap::new(), tls_cert_key_file: None,
        }),
        tls: false, tls_ca_file: None,
        tls_allow_invalid_certificates: false, ssh_enabled: false, ssh_host: None, ssh_port: 22,
        ssh_user: None, ssh_auth: None, ssh_key_file: None, tag: None, read_only: false,
        folder_id: None, last_accessed: None, open: false,
    };
    let uri = uri::with_timeout(&uri::build_uri_to(
        &cfg, cfg.engine.as_mongo().expect("just built as Mongo"), password.as_deref(), "127.0.0.1", tunnel.local_addr.port(),
    ));
    Client::with_uri_str(&uri).await?.list_database_names().await.map_err(AppError::Mongo)?;
    Ok(())
}

/// The tunnel Test Connection dials through — built by the same `tunnel_params`
/// as the pool's, so a green test means the real connection tunnels the same way.
/// `None` when SSH is off.
pub(super) async fn open_test_tunnel(
    app: tauri::AppHandle,
    known_hosts: &Arc<KnownHostsStore>,
    prompts: &Arc<HostKeyPrompts>,
    config: &ConnectionConfig,
    ssh_password: Option<String>,
    ssh_passphrase: Option<String>,
) -> Result<Option<crate::ssh::SshTunnel>, AppError> {
    if !config.ssh_enabled {
        return Ok(None);
    }
    let params = crate::pool::tunnel_params(config, ssh_password, ssh_passphrase);
    let tunnel = crate::ssh::establish(params, Arc::clone(known_hosts), Arc::clone(prompts), app).await?;
    Ok(Some(tunnel))
}

#[tauri::command]
pub fn respond_ssh_host_key(
    prompts: State<'_, Arc<HostKeyPrompts>>, request_id: u64, trust: bool,
) {
    prompts.resolve(request_id, trust);
}

#[tauri::command]
pub fn forget_ssh_host(
    known_hosts: State<'_, Arc<KnownHostsStore>>, host: String, port: u16,
) -> Result<(), AppError> {
    known_hosts.remove(&host, port)
}
