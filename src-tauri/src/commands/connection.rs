use crate::error::AppError;
use crate::known_hosts::KnownHostsStore;
use crate::node_tags::NodeTagStorage;
use crate::ssh::HostKeyPrompts;
use crate::storage::{ConnectionConfig, HostEntry, SshAuthMethod};
use super::AppContext;
use crate::uri;
use mongodb::Client;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

/// The connection editor's form, exactly as the frontend sends it. `save_connection`
/// and `update_connection` take the same payload; the fields the editor doesn't own
/// (id, folder, last_accessed, open) are supplied by the caller instead.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFields {
    pub name: String,
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

impl ConnectionFields {
    /// The stored config this form describes. The four fields the editor doesn't
    /// carry come from the caller: a new connection invents them, an edit preserves
    /// the existing record's.
    fn into_config(
        self,
        id: String,
        folder_id: Option<String>,
        last_accessed: Option<String>,
        open: bool,
    ) -> ConnectionConfig {
        ConnectionConfig {
            id: id,
            name: self.name,
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
        }
    }

    /// The three secrets, lifted out before `into_config` consumes the form.
    fn secrets(&self) -> (Option<String>, Option<String>, Option<String>) {
        (
            self.password.clone(),
            self.ssh_password.clone(),
            self.ssh_passphrase.clone(),
        )
    }
}

/// Test the connection the editor currently describes, without saving it. The URI comes
/// from `uri::build_uri` — the same function the real connect path uses — so a green test
/// means the connection will be dialled exactly the way it was tested.
///
/// `id` is set when editing an existing connection, where a blank password field means
/// "keep the stored one" (the rule `update_connection` follows); the secret then comes
/// from the keychain rather than the form.
#[tauri::command]
pub async fn test_connection(id: Option<String>, fields: ConnectionFields) -> Result<(), AppError> {
    let password = match fields.password.clone().filter(|s| !s.is_empty()) {
        Some(typed) => Some(typed),
        None => id.as_deref().and_then(crate::keychain::get),
    };
    let config = fields.into_config(id.unwrap_or_default(), None, None, false);
    let uri = uri::build_uri(&config, password.as_deref());

    match uri::tcp_probe(&uri).await {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let client = Client::with_uri_str(&uri::with_timeout(&uri)).await?;
    match client.list_database_names().await {
        Ok(_) => {},
        Err(e) => return Err(AppError::Mongo(e)),
    };
    Ok(())
}

/// Test a connection that goes through an SSH tunnel: open a temporary tunnel,
/// connect to the forwarded local port, ping, then tear the tunnel down (it
/// drops at the end of this function). TLS-over-SSH is not exercised here.
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
        ssh_host: ssh_host,
        ssh_port: ssh_port,
        ssh_user: ssh_user,
        auth: auth,
        mongo_host: mongo_host.clone(),
        mongo_port: mongo_port,
    };
    let tunnel = match crate::ssh::establish(
        params,
        Arc::clone(known_hosts.inner()),
        Arc::clone(prompts.inner()),
        app,
    )
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(e),
    };

    // Minimal config carrying just the Mongo auth fields, pointed at the tunnel.
    let cfg = ConnectionConfig {
        id: String::new(),
        name: String::new(),
        hosts: vec![HostEntry { host: mongo_host, port: mongo_port }],
        connection_type: String::from("standalone"),
        replica_set_name: None,
        username: username,
        auth_db: auth_db,
        auth_mechanism: auth_mechanism,
        options: std::collections::BTreeMap::new(),
        tls: false,
        tls_ca_file: None,
        tls_cert_key_file: None,
        tls_allow_invalid_certificates: false,
        ssh_enabled: false,
        ssh_host: None,
        ssh_port: 22,
        ssh_user: None,
        ssh_auth: None,
        ssh_key_file: None,
        tag: None,
        read_only: false,
        folder_id: None,
        last_accessed: None,
        open: false,
    };
    let local_port = tunnel.local_addr.port();
    let uri = uri::with_timeout(&uri::build_uri_to(
        &cfg,
        password.as_deref(),
        "127.0.0.1",
        local_port,
    ));
    let client = Client::with_uri_str(&uri).await?;
    match client.list_database_names().await {
        Ok(_) => {}
        Err(e) => return Err(AppError::Mongo(e)),
    };
    Ok(())
}

/// The frontend's answer to a first-contact SSH host-key prompt: deliver the
/// user's trust decision to the SSH handshake that is waiting on it.
#[tauri::command]
pub fn respond_ssh_host_key(prompts: State<'_, Arc<HostKeyPrompts>>, request_id: u64, trust: bool) {
    prompts.resolve(request_id, trust);
}

/// Forget a host's trusted SSH key so the next connection re-prompts as a fresh
/// first contact. The recovery path after a legitimate server key rotation.
#[tauri::command]
pub fn forget_ssh_host(
    known_hosts: State<'_, Arc<KnownHostsStore>>,
    host: String,
    port: u16,
) -> Result<(), AppError> {
    known_hosts.remove(&host, port)
}

/// Which stored secrets an updated config can still use. A `false` means the
/// setting that justified the secret is gone — no username (or auth turned off),
/// SSH disabled, or SSH switched to the other auth method — so the keychain entry
/// should be dropped rather than left behind.
///
/// Kept as a pure function so the decision is unit-testable without touching a real
/// OS keychain. Returns `(password, ssh_password, ssh_passphrase)`.
pub(crate) fn usable_secrets(config: &ConnectionConfig) -> (bool, bool, bool) {
    let no_auth = config.auth_mechanism.as_deref() == Some("none");
    let has_user = !no_auth
        && config.username.as_deref().filter(|s| !s.is_empty()).is_some();
    let ssh_password = config.ssh_enabled && config.ssh_auth.as_deref() == Some("password");
    let ssh_passphrase = config.ssh_enabled && config.ssh_auth.as_deref() == Some("key");
    (has_user, ssh_password, ssh_passphrase)
}

/// Save a new connection. `copy_secrets_from` is the id this one was copied from, if
/// any: the editor leaves secret fields blank to mean "keep the existing one", which for
/// a copy means the source's, since the new id has nothing stored under it yet.
#[tauri::command]
pub async fn save_connection(
    ctx: State<'_, AppContext>,
    fields: ConnectionFields,
    copy_secrets_from: Option<String>,
) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    let (password, ssh_password, ssh_passphrase) = fields.secrets();

    // Inherit first, so anything actually typed into the form overwrites it below.
    if let Some(source) = copy_secrets_from.as_deref() {
        match copy_secrets(source, &id) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
    }
    // A newly saved connection starts at the root (no folder) and opened in the sidebar.
    let config = fields.into_config(id.clone(), None, None, true);

    // Store password in OS keychain before persisting the rest to disk.
    let pw_ref = password.as_deref().filter(|s| !s.is_empty());
    if let Some(pw) = pw_ref {
        match crate::keychain::set(&id, pw) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
    }
    // SSH secrets live under composite keychain keys.
    if let Some(sp) = ssh_password.as_deref().filter(|s| !s.is_empty()) {
        match crate::keychain::set(&format!("{}::ssh-pass", id), sp) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
    }
    if let Some(pp) = ssh_passphrase.as_deref().filter(|s| !s.is_empty()) {
        match crate::keychain::set(&format!("{}::ssh-key-pass", id), pp) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
    }

    match ctx.storage.add(config.clone()) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };

    // Create and cache the client immediately so the first expand is instant.
    // The password was just written to the keychain above, so the pool reads it
    // back when it opens the connection.
    match ctx.pool.connect(&config).await {
        Ok(_) => {}
        Err(e) => return Err(e),
    };

    Ok(id)
}

#[tauri::command]
pub fn list_connections(ctx: State<'_, AppContext>) -> Vec<ConnectionConfig> {
    ctx.storage.load()
}

/// Assemble the MongoDB connection string for a saved connection. The password is
/// deliberately omitted — credentials live in the OS keychain and are never handed
/// to the frontend; the URI carries the username + auth/TLS options only.
#[tauri::command]
pub fn connection_uri(ctx: State<'_, AppContext>, id: String) -> Result<String, AppError> {
    let config = match ctx.storage.find(&id) {
        Some(val) => val,
        None => return Err(AppError::UnknownConnection(id)),
    };
    Ok(crate::uri::build_uri(&config, None))
}

/// The three keychain keys a connection may hold a secret under. Secrets are keyed by
/// connection id, with the SSH ones under composite keys.
fn secret_keys(id: &str) -> [String; 3] {
    [
        id.to_string(),
        format!("{}::ssh-pass", id),
        format!("{}::ssh-key-pass", id),
    ]
}

/// Copy every secret one connection holds to another id's keys. A copy of a connection
/// is a new id with nothing stored under it, so without this it would authenticate as
/// nobody while looking correctly configured.
fn copy_secrets(from: &str, to: &str) -> Result<(), AppError> {
    for (source, target) in secret_keys(from).iter().zip(secret_keys(to).iter()) {
        if let Some(secret) = crate::keychain::get(source) {
            match crate::keychain::set(target, &secret) {
                Ok(val) => val,
                Err(e) => return Err(e),
            };
        }
    }
    Ok(())
}

/// Duplicate a saved connection: clone its config under a new id and a "(copy)"
/// name, carry over any keychain secrets to the new id, and persist it. The copy
/// starts closed (not shown in the sidebar) and with no last-accessed time.
#[tauri::command]
pub fn duplicate_connection(
    ctx: State<'_, AppContext>,
    id: String,
) -> Result<ConnectionConfig, AppError> {
    let original = match ctx.storage.find(&id) {
        Some(val) => val,
        None => return Err(AppError::UnknownConnection(id)),
    };
    let new_id = Uuid::new_v4().to_string();
    let mut copy = original.clone();
    copy.id = new_id.clone();
    copy.name = format!("{} (copy)", original.name);
    copy.last_accessed = None;
    copy.open = false;

    // Carry over keychain secrets (main password + SSH secrets) to the new id's keys.
    match copy_secrets(&id, &new_id) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    match ctx.storage.add(copy.clone()) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    Ok(copy)
}

/// Export all saved connections to a JSON file (a backup). Configs hold no
/// secrets — passwords and SSH secrets live in the OS keychain, not in the
/// config — so the exported file is inherently credential-free. Returns the count.
#[tauri::command]
pub fn export_connections(ctx: State<'_, AppContext>, path: String) -> Result<usize, AppError> {
    let connections = ctx.storage.load();
    let contents = match serde_json::to_string_pretty(&connections) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Serde(e)),
    };
    match std::fs::write(&path, contents) {
        Ok(_) => Ok(connections.len()),
        Err(e) => return Err(AppError::Io(e)),
    }
}

/// Import connections from a JSON file produced by `export_connections`. Each
/// imported connection is added with a fresh id (purely additive — never
/// overwrites an existing one) and starts closed. Imported connections carry no
/// password (none was exported), so credentials must be re-entered. Returns the
/// number imported.
#[tauri::command]
pub fn import_connections(ctx: State<'_, AppContext>, path: String) -> Result<usize, AppError> {
    let contents = match std::fs::read_to_string(&path) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Io(e)),
    };
    let imported: Vec<ConnectionConfig> = match serde_json::from_str(&contents) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Serde(e)),
    };
    let mut count = 0;
    for connection in imported {
        let mut fresh = connection;
        fresh.id = Uuid::new_v4().to_string();
        fresh.last_accessed = None;
        fresh.open = false;
        match ctx.storage.add(fresh) {
            Ok(_) => count += 1,
            Err(e) => return Err(e),
        };
    }
    Ok(count)
}

#[tauri::command]
pub async fn update_connection(
    ctx: State<'_, AppContext>,
    id: String,
    fields: ConnectionFields,
) -> Result<ConnectionConfig, AppError> {
    // Preserve last_accessed, folder membership, and the open state from the
    // existing record (the edit dialog doesn't carry these fields).
    let existing = ctx.storage.find(&id);
    let last_accessed = existing.as_ref().and_then(|c| c.last_accessed.clone());
    let folder_id = existing.as_ref().and_then(|c| c.folder_id.clone());
    let open = existing.as_ref().map(|c| c.open).unwrap_or(true);

    let (password, ssh_password, ssh_passphrase) = fields.secrets();
    let config = fields.into_config(id.clone(), folder_id, last_accessed, open);

    // Update keychain only when a new secret is supplied; empty = keep existing.
    let pw_ref = password.as_deref().filter(|s| !s.is_empty());
    if let Some(pw) = pw_ref {
        match crate::keychain::set(&id, pw) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
    }
    if let Some(sp) = ssh_password.as_deref().filter(|s| !s.is_empty()) {
        match crate::keychain::set(&format!("{}::ssh-pass", id), sp) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
    }
    if let Some(pp) = ssh_passphrase.as_deref().filter(|s| !s.is_empty()) {
        match crate::keychain::set(&format!("{}::ssh-key-pass", id), pp) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
    }

    // Drop secrets the updated config can no longer use, so a credential doesn't
    // outlive the setting that needed it. "Leave blank to keep existing" only holds
    // while the field still applies — clearing the username, turning SSH off, or
    // switching SSH auth retires the corresponding secret.
    let (keep_password, keep_ssh_password, keep_ssh_passphrase) = usable_secrets(&config);
    if !keep_password {
        crate::keychain::delete(&id);
    }
    if !keep_ssh_password {
        crate::keychain::delete(&format!("{}::ssh-pass", id));
    }
    if !keep_ssh_passphrase {
        crate::keychain::delete(&format!("{}::ssh-key-pass", id));
    }

    match ctx.storage.update(config.clone()) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };

    // Evict cached client so the next operation reconnects with updated credentials.
    ctx.pool.remove(&id).await;

    // Returned so the frontend refreshes its copies from what was actually stored,
    // rather than rebuilding the record from the form a second time.
    Ok(config)
}

#[tauri::command]
pub async fn delete_connection(
    ctx: State<'_, AppContext>,
    node_tags: State<'_, NodeTagStorage>,
    id: String,
) -> Result<(), AppError> {
    match ctx.storage.remove(&id) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    ctx.pool.remove(&id).await;
    crate::keychain::delete(&id);
    crate::keychain::delete(&format!("{}::ssh-pass", id));
    crate::keychain::delete(&format!("{}::ssh-key-pass", id));
    // Best-effort: drop this connection's database/collection colour tags so they
    // don't linger in node_tags.json. A failure here shouldn't fail the delete.
    let _ = node_tags.remove_connection(&id);
    Ok(())
}

#[tauri::command]
pub async fn disconnect(
    ctx: State<'_, AppContext>,
    id: String,
) -> Result<(), AppError> {
    ctx.pool.remove(&id).await;
    Ok(())
}

#[tauri::command]
pub fn set_connection_open(
    ctx: State<'_, AppContext>,
    id: String,
    open: bool,
) -> Result<(), AppError> {
    ctx.storage.update_with(|connections| {
        if let Some(c) = connections.iter_mut().find(|c| c.id == id) {
            c.open = open;
        }
    })
}

/// Persist the colour tag chosen for a connection from the tree's Choose Color
/// menu, so it survives a restart. The colour "none" clears the tag. Database and
/// collection tags are handled separately by `set_node_tag`.
#[tauri::command]
pub fn set_connection_tag(
    ctx: State<'_, AppContext>,
    id: String,
    color: String,
) -> Result<(), AppError> {
    ctx.storage.update_with(|connections| {
        if let Some(c) = connections.iter_mut().find(|c| c.id == id) {
            c.tag = if color == "none" { None } else { Some(color.clone()) };
        }
    })
}

#[tauri::command]
pub fn update_last_accessed(
    ctx: State<'_, AppContext>,
    id: String,
    timestamp: String,
) -> Result<(), AppError> {
    ctx.storage.update_with(|connections| {
        if let Some(c) = connections.iter_mut().find(|c| c.id == id) {
            c.last_accessed = Some(timestamp);
        }
    })
}

#[tauri::command]
pub fn open_document_window(app: tauri::AppHandle, target: crate::menu::DocumentTarget) {
    crate::menu::open_document_window(&app, target);
}

#[cfg(test)]
#[path = "connection.test.rs"]
mod tests;
