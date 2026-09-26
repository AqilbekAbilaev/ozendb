use crate::error::AppError;
use crate::node_tags::NodeTagStorage;
use crate::storage::{ConnectionConfig, EngineConfig, MongoConfig};
use super::AppContext;
use crate::known_hosts::KnownHostsStore;
use crate::ssh::HostKeyPrompts;
use crate::uri;
use mongodb::Client;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

mod ssh;
pub use ssh::{forget_ssh_host, respond_ssh_host_key};
use ssh::open_test_tunnel;

mod postgres;
use postgres::test_postgres_connection;

mod fields;
use fields::ConnectionFields;

/// Test the connection the editor currently describes, without saving it. Dials
/// through `uri::build_uri` (MongoDB) or `pg_uri::build_options` (PostgreSQL) — the
/// same functions the real connect paths use — so a green test means the connection
/// will be dialled exactly the way it was tested.
///
/// `id` is set when editing an existing connection, where a blank password field means
/// "keep the stored one" (the rule `update_connection` follows); the secret then comes
/// from the keychain rather than the form. The engine always comes from the stored
/// record (an edit can't switch drivers), and a blank database falls back to it.
#[tauri::command]
pub async fn test_connection(
    app: tauri::AppHandle,
    ctx: State<'_, AppContext>,
    known_hosts: State<'_, Arc<KnownHostsStore>>,
    prompts: State<'_, Arc<HostKeyPrompts>>,
    id: Option<String>,
    fields: ConnectionFields,
) -> Result<(), AppError> {
    let existing = id.as_deref().and_then(|val| ctx.storage.find(val));
    let typed_or_stored = |typed: Option<String>, key: Option<String>| {
        typed.filter(|s| !s.is_empty()).or_else(|| key.as_deref().and_then(crate::keychain::get))
    };
    let password = typed_or_stored(fields.password.clone(), id.clone());
    let ssh_password = typed_or_stored(fields.ssh_password.clone(), id.as_ref().map(|v| format!("{v}::ssh-pass")));
    let ssh_passphrase = typed_or_stored(fields.ssh_passphrase.clone(), id.as_ref().map(|v| format!("{v}::ssh-key-pass")));
    let config = fields.into_config(id.unwrap_or_default(), existing.as_ref(), None, None, false)?;

    let tunnel = open_test_tunnel(app, known_hosts.inner(), prompts.inner(), &config, ssh_password, ssh_passphrase).await?;
    let via = tunnel.as_ref().map(|t| t.local_addr.port());

    // Matching the variant rather than an engine tag hands each arm exactly the
    // settings its driver needs, so neither can be called without them.
    match &config.engine {
        EngineConfig::Postgres(postgres) => {
            test_postgres_connection(&config, postgres, password.as_deref(), via).await
        }
        EngineConfig::Mongo(mongo) => {
            test_mongo_connection(&config, mongo, password.as_deref(), via).await
        }
    }
}

/// `via` is the local port of an SSH tunnel, when the connection has one.
async fn test_mongo_connection(
    config: &ConnectionConfig,
    mongo: &MongoConfig,
    password: Option<&str>,
    via: Option<u16>,
) -> Result<(), AppError> {
    let uri = match via {
        Some(port) => uri::build_uri_to(config, mongo, password, "127.0.0.1", port),
        None => uri::build_uri(config, mongo, password),
    };

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



/// Which stored secrets an updated config can still use. A `false` means the
/// setting that justified the secret is gone — no username (or auth turned off),
/// SSH disabled, or SSH switched to the other auth method — so the keychain entry
/// should be dropped rather than left behind.
///
/// Kept as a pure function so the decision is unit-testable without touching a real
/// OS keychain. Returns `(password, ssh_password, ssh_passphrase)`.
pub(crate) fn usable_secrets(config: &ConnectionConfig) -> (bool, bool, bool) {
    // Only MongoDB has an auth mechanism; on any other driver a username is a
    // username, so there is no "none" mode to suppress it.
    let no_auth = config
        .engine
        .as_mongo()
        .and_then(|mongo| mongo.auth_mechanism.as_deref())
        == Some("none");
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
    // A newly saved connection starts at the root (no folder) and opened in the
    // sidebar. `existing: None` — engine/database come from the form.
    let config = fields.into_config(id.clone(), None, None, None, true)?;

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

    // Create and cache the client/pool immediately so the first expand is instant.
    // The password was just written to the keychain above, so the pool reads it
    // back when it opens the connection.
    let warm = match &config.engine {
        EngineConfig::Postgres(_) => ctx.pool.connect_postgres(&config).await.map(|_| ()),
        EngineConfig::Mongo(_) => ctx.pool.connect(&config).await.map(|_| ()),
    };
    if let Err(e) = warm {
        return Err(e);
    }

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
    // MongoDB-only by definition — it returns a `mongodb://` string. A Postgres
    // connection has no MongoDB settings to build one from, so this says so rather
    // than inventing a URI in the wrong dialect.
    let mongo = match config.engine.as_mongo() {
        Some(mongo) => mongo,
        None => {
            return Err(AppError::Validation(
                "A connection string is only available for MongoDB connections.".to_string(),
            ))
        }
    };
    Ok(crate::uri::build_uri(&config, mongo, None))
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
    let config = fields.into_config(id.clone(), existing.as_ref(), folder_id, last_accessed, open)?;

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
