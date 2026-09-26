use crate::error::AppError;
use crate::known_hosts::KnownHostsStore;
use crate::ssh::HostKeyPrompts;
use crate::storage::ConnectionConfig;
use std::sync::Arc;
use tauri::State;

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
