use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn default_connection_type() -> String { String::from("standalone") }

/// The persisted spelling of each driver — the `engine` key in `connections.json`
/// and the value `EngineConfig`'s tag is read from and written as.
const MONGODB: &str = "mongodb";
const POSTGRESQL: &str = "postgresql";

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
