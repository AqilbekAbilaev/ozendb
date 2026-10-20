use crate::error::AppError;
use crate::record::{Record, RecordList, Stamp};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

mod engine;
pub use engine::*;

fn default_ssh_port() -> u16 { 22 }

/// One host of a (possibly multi-host) seed list. SRV connections use a single
/// entry and ignore the port.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct HostEntry {
    pub host: String,
    pub port: u16,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    /// The seed list. Normally populated by the connection editor; `uri::build_uri`
    /// falls back to `localhost:27017` if it is ever empty. Shared because every
    /// driver dials a host — MongoDB uses the whole list, PostgreSQL only the first.
    #[serde(default)]
    pub hosts: Vec<HostEntry>,
    #[serde(default)]
    pub username: Option<String>,
    // TLS / SSL. `tls` enables it; how it is applied is the driver's business
    // (connection-string options for MongoDB, typed `PgConnectOptions` for
    // PostgreSQL). Only the settings every driver honors live here — a client
    // certificate, for instance, is MongoDB-only today and sits in `MongoConfig`.
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub tls_ca_file: Option<String>,
    #[serde(default)]
    pub tls_allow_invalid_certificates: bool,
    // SSH tunnel. When enabled, the driver connects through a local forwarded
    // port (see ssh.rs / pool::connect). Secrets live in the keychain, not here.
    #[serde(default)]
    pub ssh_enabled: bool,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default = "default_ssh_port")]
    pub ssh_port: u16,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub ssh_auth: Option<String>,
    #[serde(default)]
    pub ssh_key_file: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    // When true, mutating operations against this connection are refused at the
    // backend choke point (`client_for_write` in commands/mod.rs) before they reach
    // the driver — a real lock, not just hidden UI.
    #[serde(default)]
    pub read_only: bool,
    // The folder this connection belongs to in the Connection Manager, or `None`
    // for a connection at the root. Folders themselves live in `folders.json`.
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub last_accessed: Option<String>,
    // Whether the connection is currently open in the sidebar tree. Persisted so
    // only the connections that were open are re-opened after a restart.
    #[serde(default)]
    pub open: bool,
    #[serde(flatten)]
    pub stamp: Stamp,
    /// Everything that is this driver's business and no other's. Flattened, so the
    /// driver's own keys sit alongside the shared ones in `connections.json` exactly
    /// as they did when this was one flat struct — see `EngineConfig`.
    #[serde(flatten)]
    pub engine: EngineConfig,
}


/// How an SSH tunnel authenticates, as an exhaustively-matchable view of the
/// stored `ssh_auth` string. As with `ConnectionKind`, the string stays the
/// persisted/wire form and this is only the internal view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SshAuthMethod {
    Password,
    Key,
}

impl SshAuthMethod {
    /// Maps a stored or frontend-supplied `ssh_auth` value to a method. `None`,
    /// empty, or any unknown string falls back to `Password` — matching the prior
    /// `_ => Password` default in `pool.rs`.
    pub fn from_opt(value: Option<&str>) -> SshAuthMethod {
        match value {
            Some("key") => SshAuthMethod::Key,
            _ => SshAuthMethod::Password,
        }
    }
}

/// A blank MongoDB connection. Exists so a caller that cares about three fields can
/// say so and leave the rest — the alternative is spelling all twenty out at every
/// construction site, which is how `ssh.rs` and the tests each ended up with their
/// own full literal to re-edit whenever a field is added.
impl Default for ConnectionConfig {
    fn default() -> Self {
        ConnectionConfig {
            id: String::new(),
            name: String::new(),
            hosts: Vec::new(),
            username: None,
            tls: false,
            tls_ca_file: None,
            tls_allow_invalid_certificates: false,
            ssh_enabled: false,
            ssh_host: None,
            ssh_port: default_ssh_port(),
            ssh_user: None,
            ssh_auth: None,
            ssh_key_file: None,
            tag: None,
            read_only: false,
            folder_id: None,
            last_accessed: None,
            open: false,
            stamp: Stamp::default(),
            engine: EngineConfig::default(),
        }
    }
}

crate::stamped!(ConnectionConfig);

// `open` and `last_accessed` are this device's own state: they change through
// `edit_device_only`, so they never stamp the record or sync.
impl Record for ConnectionConfig {
    fn id(&self) -> String {
        self.id.clone()
    }

    fn emptied(&self) -> Self {
        ConnectionConfig { id: self.id.clone(), ..ConnectionConfig::default() }
    }
}

impl ConnectionConfig {
    /// Which driver this connection dials. Derived from the `engine` variant rather
    /// than from a string, so it can no longer disagree with the settings it carries.
    pub fn engine_kind(&self) -> Engine {
        self.engine.engine()
    }

    /// The record without this device's own state (`open`, `last_accessed`): the part
    /// that syncs.
    pub fn shared_part(&self) -> ConnectionConfig {
        ConnectionConfig { open: false, last_accessed: None, ..self.clone() }
    }

    /// The SSH auth method as an exhaustively-matchable enum. Derived from the
    /// stored `ssh_auth` string; see `SshAuthMethod`.
    pub fn ssh_auth_method(&self) -> SshAuthMethod {
        SshAuthMethod::from_opt(self.ssh_auth.as_deref())
    }
}

// Intentionally bespoke — not a JsonStore<T>: this store owns an in-memory cache
// (the source of truth once loaded), so its read/write path diverges from the
// plain load-mutate-save the generic covers.
pub struct Storage {
    path: PathBuf,
    // Cached connection list — the in-memory source of truth once loaded. `None`
    // until first access (lazy load) or after a failed write. Every read is served
    // from here; every mutation updates this and the file together under the lock,
    // so a read never hits disk on a cache hit. The lock also serializes
    // read-modify-write sequences so concurrent commands can't lose each other's
    // updates.
    //
    // Tradeoff: external hand-edits to connections.json while the app is running
    // are not observed until the next mutation or an app restart. Live external
    // edits are unsupported, so this is acceptable.
    cache: Mutex<Option<Vec<ConnectionConfig>>>,
}

impl Storage {
    pub fn new(path: PathBuf) -> Self {
        Self { path, cache: Mutex::new(None) }
    }

    // The poison-tolerant cache guard. A panic in another thread while the lock is
    // held poisons it; we recover the inner data rather than propagate the panic.
    fn lock_cache(&self) -> MutexGuard<'_, Option<Vec<ConnectionConfig>>> {
        match self.cache.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    // Reads and parses the list straight from disk. Does not touch the lock, so it
    // can run inside a held `lock_cache()` guard without re-entrancy. Called only on
    // a cache miss / first load.
    fn read_from_disk(&self) -> Vec<ConnectionConfig> {
        if !self.path.exists() {
            return vec![];
        }
        // A file that exists but can't be read/parsed is quarantined aside (not
        // silently emptied), so the next write persists a fresh file instead of
        // overwriting the recoverable original. See persist::quarantine_corrupt.
        let content = match std::fs::read_to_string(&self.path) {
            Ok(value) => value,
            Err(error) => {
                eprintln!(
                    "storage: failed to read {}: {}",
                    self.path.display(),
                    error
                );
                crate::persist::quarantine_corrupt(&self.path);
                return vec![];
            }
        };
        match serde_json::from_str(&content) {
            Ok(value) => value,
            Err(error) => {
                eprintln!(
                    "storage: failed to parse {}: {}",
                    self.path.display(),
                    error
                );
                crate::persist::quarantine_corrupt(&self.path);
                vec![]
            }
        }
    }

    // Serializes and atomically writes the list. Pure disk write, no lock.
    fn write_disk(&self, connections: &[ConnectionConfig]) -> Result<(), AppError> {
        let content = match serde_json::to_string_pretty(connections) {
            Ok(val) => val,
            Err(e) => return Err(AppError::Serde(e)),
        };
        crate::persist::atomic_write(&self.path, &content)
    }

    pub fn load(&self) -> Vec<ConnectionConfig> {
        let mut guard = self.lock_cache();
        let connections = guard.get_or_insert_with(|| self.read_from_disk());
        connections.clone().live()
    }

    /// The persisted config for `id`, if any. This is the authoritative source of
    /// a connection's URI — commands resolve it here rather than trusting the
    /// frontend to send the URI on every call.
    pub fn find(&self, id: &str) -> Option<ConnectionConfig> {
        let mut guard = self.lock_cache();
        let connections = guard.get_or_insert_with(|| self.read_from_disk());
        connections.iter().find(|c| c.id == id && !c.stamp.deleted).cloned()
    }

    /// Apply `mutate` to the connection list under the lock, persist, then sync the
    /// cache. The one cache-consistent write core: `add`/`update`/`remove` delegate
    /// here so no mutation path can forget to update the cache, and two concurrent
    /// field updates (e.g. set-open + set-last-accessed) still serialize on the one
    /// lock so neither is lost.
    pub fn update_with<F>(&self, mutate: F) -> Result<(), AppError>
    where
        F: FnOnce(&mut Vec<ConnectionConfig>),
    {
        let mut guard = self.lock_cache();
        let mut connections = match guard.take() {
            Some(connections) => connections,
            None => self.read_from_disk(),
        };
        mutate(&mut connections);
        match self.write_disk(&connections) {
            Ok(()) => {
                *guard = Some(connections);
                Ok(())
            }
            // Persist failed: don't cache the unpersisted change. Leaving the cache
            // empty forces the next read to reload the last good state from disk.
            Err(e) => {
                *guard = None;
                Err(e)
            }
        }
    }

    /// Every record, deleted markers included: what sync sends.
    pub fn records(&self) -> Vec<ConnectionConfig> {
        let mut guard = self.lock_cache();
        guard.get_or_insert_with(|| self.read_from_disk()).clone()
    }

    /// Replaces the list with `after` only if its shared part still equals `before`'s.
    /// Opening or using a connection meanwhile doesn't count as a change, and keeps its
    /// newer `open` and `last_accessed`. Returns whether it replaced the list.
    pub fn replace_synced_if_unchanged(&self, before: &[ConnectionConfig], after: Vec<ConnectionConfig>) -> Result<bool, AppError> {
        let synced = |list: &[ConnectionConfig]| serde_json::to_value(list.iter().map(ConnectionConfig::shared_part).collect::<Vec<_>>());
        let before = synced(before)?;
        let mut replaced = false;
        self.update_with(|current| {
            if synced(current).ok() != Some(before) {
                return;
            }
            let mut after = after;
            for config in after.iter_mut() {
                if let Some(now) = current.iter().find(|c| c.id == config.id) {
                    config.open = now.open;
                    config.last_accessed = now.last_accessed.clone();
                }
            }
            *current = after;
            replaced = true;
        })?;
        Ok(replaced)
    }

    pub fn add(&self, config: ConnectionConfig) -> Result<(), AppError> {
        self.update_with(|connections| connections.put(connections.len(), config))
    }

    pub fn update(&self, config: ConnectionConfig) -> Result<(), AppError> {
        self.update_with(|connections| connections.edit_where(|c| c.id == config.id, |c| *c = config.clone()))
    }

    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        self.update_with(|connections| connections.delete_where(|c| c.id == id))
    }

    // Replace the whole list: write to disk, then sync the cache. Only the tests
    // use this — the app mutates through `update_with` and its `add`/`update`/
    // `remove` delegates, so it's compiled in test builds only.
    #[cfg(test)]
    fn save(&self, connections: &[ConnectionConfig]) -> Result<(), AppError> {
        let mut guard = self.lock_cache();
        match self.write_disk(connections) {
            Ok(()) => {
                *guard = Some(connections.to_vec());
                Ok(())
            }
            Err(e) => {
                *guard = None;
                Err(e)
            }
        }
    }
}

#[cfg(test)]
#[path = "storage.test.rs"]
mod tests;
