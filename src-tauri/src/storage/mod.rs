use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

fn default_connection_type() -> String { String::from("standalone") }
fn default_ssh_port() -> u16 { 22 }

/// The persisted spelling of each driver — the `engine` key in `connections.json`
/// and the value `EngineConfig`'s tag is read from and written as.
const MONGODB: &str = "mongodb";
const POSTGRESQL: &str = "postgresql";

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
    /// Everything that is this driver's business and no other's. Flattened, so the
    /// driver's own keys sit alongside the shared ones in `connections.json` exactly
    /// as they did when this was one flat struct — see `EngineConfig`.
    #[serde(flatten)]
    pub engine: EngineConfig,
}

/// The driver-specific half of a connection: one variant per driver, each owning
/// only the settings that driver actually reads.
///
/// Splitting these out is what stops a setting from being silently ignored. While
/// this was one flat struct, a Postgres connection still carried `options`,
/// `auth_mechanism` and `tls_cert_key_file` — fields the Postgres path never looks
/// at, so anything the user put there was dropped without a word. Now they don't
/// exist on a Postgres connection at all, and giving Postgres client certificates
/// later means adding a field to `PostgresConfig`, not teaching a shared field to
/// mean two things.
///
/// Persisted flat and tagged by `engine` rather than nested, so the four-key-deep
/// shape of an existing `connections.json` is unchanged and no migration runs.
#[derive(Clone, Debug, PartialEq)]
pub enum EngineConfig {
    Mongo(MongoConfig),
    Postgres(PostgresConfig),
}

/// MongoDB's own settings. `options` and `tls_cert_key_file` live here rather than
/// on the shared struct because they are MongoDB URI concepts: the first is spliced
/// verbatim into the connection string, the second is a `tlsCertificateKeyFile`
/// parameter. PostgreSQL expresses both differently and would need its own fields.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MongoConfig {
    #[serde(default = "default_connection_type")]
    pub connection_type: String,
    #[serde(default)]
    pub replica_set_name: Option<String>,
    #[serde(default)]
    pub auth_db: Option<String>,
    #[serde(default)]
    pub auth_mechanism: Option<String>,
    // Passthrough connection-string options the dedicated fields don't model
    // (e.g. retryWrites, socketTimeoutMS, readPreference). Appended verbatim to
    // the built URI so any driver-accepted parameter round-trips.
    #[serde(default)]
    pub options: BTreeMap<String, String>,
    #[serde(default)]
    pub tls_cert_key_file: Option<String>,
}

/// PostgreSQL's own settings.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct PostgresConfig {
    /// A Postgres connection must name one database up front, unlike MongoDB, which
    /// connects at the server level and picks a database per query.
    #[serde(default)]
    pub database: Option<String>,
}

impl Default for MongoConfig {
    fn default() -> Self {
        MongoConfig {
            connection_type: default_connection_type(),
            replica_set_name: None,
            auth_db: None,
            auth_mechanism: None,
            options: BTreeMap::new(),
            tls_cert_key_file: None,
        }
    }
}

impl Default for EngineConfig {
    /// MongoDB, matching what a record with no `engine` key deserializes to.
    fn default() -> Self {
        EngineConfig::Mongo(MongoConfig::default())
    }
}

// Hand-written rather than `#[serde(tag = "engine")]` for one reason: serde's
// internally-tagged derive *requires* the tag to be present, and every
// `connections.json` written before the `engine` field existed has no such key.
// The derive would fail to load them; this reads the tag with a MongoDB default,
// which is the only driver those files could describe.
impl<'de> Deserialize<'de> for EngineConfig {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let map = serde_json::Map::deserialize(deserializer)?;
        // `"postgres"` is accepted alongside the canonical `"postgresql"` — it is
        // the spelling sqlx, libpq and the URI scheme all use, so a hand-edited
        // file may well carry it, and guessing the wrong driver is far worse than
        // accepting a synonym. Anything else is an error rather than a guess.
        let engine = map.get("engine").and_then(|v| v.as_str()).unwrap_or(MONGODB);
        let variant = match engine {
            MONGODB => serde_json::from_value(serde_json::Value::Object(map.clone()))
                .map(EngineConfig::Mongo),
            POSTGRESQL | "postgres" => {
                serde_json::from_value(serde_json::Value::Object(map.clone()))
                    .map(EngineConfig::Postgres)
            }
            other => return Err(D::Error::custom(format!("unknown connection engine \"{other}\""))),
        };
        variant.map_err(D::Error::custom)
    }
}

// The mirror of the above: writes the driver's own keys flat, plus the `engine`
// tag that `Deserialize` reads back.
impl Serialize for EngineConfig {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error;
        let (tag, value) = match self {
            EngineConfig::Mongo(config) => (MONGODB, serde_json::to_value(config)),
            EngineConfig::Postgres(config) => (POSTGRESQL, serde_json::to_value(config)),
        };
        let mut map = match value.map_err(S::Error::custom)? {
            serde_json::Value::Object(map) => map,
            _ => return Err(S::Error::custom("engine config must serialize to an object")),
        };
        map.insert(String::from("engine"), serde_json::Value::String(String::from(tag)));
        serde_json::Value::Object(map).serialize(serializer)
    }
}

/// The database driver, as an exhaustively-matchable view of the stored `engine`
/// string. As with `ConnectionKind` below, the string stays the persisted/wire
/// form and this is only the internal view — matched on wherever code needs to
/// pick a driver-specific path (pool connect, URI building, command dispatch).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Engine {
    Mongo,
    Postgres,
}

impl EngineConfig {
    /// Which driver this is, without the caller having to match the whole variant.
    pub fn engine(&self) -> Engine {
        match self {
            EngineConfig::Mongo(_) => Engine::Mongo,
            EngineConfig::Postgres(_) => Engine::Postgres,
        }
    }

    /// The MongoDB settings, or `None` on a Postgres connection. Callers that have
    /// already established the driver (the Mongo URI builder, reached only from the
    /// Mongo arm of the pool) still go through this rather than unwrapping, so a
    /// mismatch surfaces as a handled error instead of a panic.
    pub fn as_mongo(&self) -> Option<&MongoConfig> {
        match self {
            EngineConfig::Mongo(config) => Some(config),
            EngineConfig::Postgres(_) => None,
        }
    }

    /// The PostgreSQL settings, or `None` on a MongoDB connection.
    pub fn as_postgres(&self) -> Option<&PostgresConfig> {
        match self {
            EngineConfig::Postgres(config) => Some(config),
            EngineConfig::Mongo(_) => None,
        }
    }
}

impl MongoConfig {
    /// The connection scheme as an exhaustively-matchable enum. Derived from the
    /// stored `connection_type` string; see `ConnectionKind`.
    pub fn kind(&self) -> ConnectionKind {
        ConnectionKind::from_str(&self.connection_type)
    }
}

/// The connection scheme, as an exhaustively-matchable view of the stored
/// `connection_type` string. The string remains the persisted/wire form (the
/// frontend sends it and it round-trips through `connections.json` untouched);
/// this enum exists only so internal code can `match` on the meaning without
/// re-testing string literals in several places.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConnectionKind {
    /// Direct or multi-host seed list — `mongodb://`.
    Standalone,
    /// DNS SRV record — `mongodb+srv://` (single hostname, no port).
    Srv,
    /// Replica set (still `mongodb://` today; distinguished for completeness).
    Replica,
}

impl ConnectionKind {
    /// Maps a stored `connection_type` string to a kind. Any unknown or legacy
    /// value falls back to `Standalone` — the non-SRV path, which is exactly how
    /// `uri.rs` behaved before this enum existed (only `"srv"` was special-cased,
    /// everything else took the plain `mongodb://` branch).
    pub fn from_str(value: &str) -> ConnectionKind {
        match value {
            "srv" => ConnectionKind::Srv,
            "replica" => ConnectionKind::Replica,
            _ => ConnectionKind::Standalone,
        }
    }
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
            engine: EngineConfig::default(),
        }
    }
}

impl ConnectionConfig {
    /// Which driver this connection dials. Derived from the `engine` variant rather
    /// than from a string, so it can no longer disagree with the settings it carries.
    pub fn engine_kind(&self) -> Engine {
        self.engine.engine()
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
        Self { path: path, cache: Mutex::new(None) }
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
        connections.clone()
    }

    /// The persisted config for `id`, if any. This is the authoritative source of
    /// a connection's URI — commands resolve it here rather than trusting the
    /// frontend to send the URI on every call.
    pub fn find(&self, id: &str) -> Option<ConnectionConfig> {
        let mut guard = self.lock_cache();
        let connections = guard.get_or_insert_with(|| self.read_from_disk());
        connections.iter().find(|c| c.id == id).cloned()
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

    pub fn add(&self, config: ConnectionConfig) -> Result<(), AppError> {
        self.update_with(|connections| connections.push(config))
    }

    pub fn update(&self, config: ConnectionConfig) -> Result<(), AppError> {
        self.update_with(|connections| {
            if let Some(c) = connections.iter_mut().find(|c| c.id == config.id) {
                *c = config;
            }
        })
    }

    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        self.update_with(|connections| connections.retain(|c| c.id != id))
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
