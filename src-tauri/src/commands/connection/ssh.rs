use crate::error::AppError;
use crate::known_hosts::KnownHostsStore;
use crate::ssh::HostKeyPrompts;
use crate::storage::{ConnectionConfig, HostEntry, SshAuthMethod};
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
        id: String::new(), name: String::new(), engine: String::from("mongodb"), database: None,
        hosts: vec![HostEntry { host: mongo_host, port: mongo_port }],
        connection_type: String::from("standalone"), replica_set_name: None, username, auth_db, auth_mechanism,
        options: std::collections::BTreeMap::new(), tls: false, tls_ca_file: None, tls_cert_key_file: None,
        tls_allow_invalid_certificates: false, ssh_enabled: false, ssh_host: None, ssh_port: 22,
        ssh_user: None, ssh_auth: None, ssh_key_file: None, tag: None, read_only: false,
        folder_id: None, last_accessed: None, open: false,
    };
    let uri = uri::with_timeout(&uri::build_uri_to(
        &cfg, password.as_deref(), "127.0.0.1", tunnel.local_addr.port(),
    ));
    Client::with_uri_str(&uri).await?.list_database_names().await.map_err(AppError::Mongo)?;
    Ok(())
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
