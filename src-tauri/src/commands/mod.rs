use crate::error::AppError;
use crate::pool::ConnectionPool;
use crate::storage::Storage;
use mongodb::bson;
use mongodb::Client;
use mongodb::Collection;
use serde::Serialize;
use std::time::Duration;

pub mod connection;
pub mod query;
pub mod admin;
pub mod persistence;
pub mod shell;
pub mod schema;
pub mod sql;
pub mod stats;
pub mod duplicate;
pub mod serverinfo;
pub mod profiler;
pub mod search;
pub mod gridfs;
pub mod users;
pub mod functions;
pub mod mapreduce;
pub mod copyops;
pub mod folders;
pub mod portmap;
pub mod history;
pub mod operations;

pub use connection::*;
pub use query::*;
pub use admin::*;
pub use persistence::*;
pub use shell::*;
pub use schema::*;
pub use sql::*;
pub use stats::*;
pub use duplicate::*;
pub use serverinfo::*;
pub use profiler::*;
pub use search::*;
pub use gridfs::*;
pub use users::*;
pub use functions::*;
pub use mapreduce::*;
pub use copyops::*;
pub use folders::*;
pub use portmap::*;
pub use history::*;
pub use operations::*;

// Helper modules carved out of this file when it outgrew the size limit. Unlike the
// command modules above these expose no Tauri commands — they're the shared parsing,
// export and import machinery the commands call. Re-exported flat so every existing
// `super::stream_import` / `crate::commands::parse_ejson_document` call site keeps
// working without touching the caller.
mod ejson;
mod export;
mod import;

pub(crate) use ejson::*;
pub(crate) use export::*;
pub(crate) use import::*;

// Server-side time cap on user queries so a runaway find/aggregate aborts on the
// server instead of hanging the UI (Tauri commands can't be cancelled in-flight).
pub(crate) const MAX_QUERY_TIME: Duration = Duration::from_secs(60);

/// Record a long-running operation in the Operations registry (the one place all
/// operations are tracked) while it runs, without changing what the command returns.
/// Pass `Some(meta)` to track (a `running` record is inserted, then stamped
/// `succeeded`/`failed` from the outcome) or `None` to run untracked — so a single
/// call site can decide per-invocation whether an op is worth logging (e.g. only
/// user-initiated query runs, not internal sampling reads). The awaited value is
/// returned verbatim so callers wrap their existing body with no other change.
pub(crate) async fn tracked<F, T>(
    registry: &crate::operations::OperationsRegistry,
    meta: Option<crate::operations::OpMeta>,
    fut: F,
) -> Result<T, AppError>
where
    F: std::future::Future<Output = Result<T, AppError>>,
{
    let id = match meta {
        Some(op_meta) => Some(registry.start(op_meta)),
        None => None,
    };
    let result = fut.await;
    if let Some(op_id) = id {
        match &result {
            Ok(_) => registry.finish(&op_id, "succeeded", None),
            Err(e) => registry.finish(&op_id, "failed", Some(e.to_string())),
        }
    }
    result
}

/// Resolve the live MongoDB client for a saved connection: look up its config and
/// hand off to the pool, which caches the client and reads credentials from the
/// keychain only when it actually opens a new connection. Every command that
/// operates on a connection goes through here, so the config-lookup + connect
/// dance lives in exactly one place (and the keychain read stays off the hot path).
pub(crate) async fn client_for(
    pool: &ConnectionPool,
    storage: &Storage,
    id: &str,
) -> Result<Client, AppError> {
    let config = match storage.find(id) {
        Some(val) => val,
        None => return Err(AppError::UnknownConnection(id.to_string())),
    };
    pool.connect(&config).await
}

/// The write-gated sibling of `client_for`: every mutating command resolves its
/// client through here instead, so a connection flagged `read_only` is refused at a
/// single choke point before any write reaches the driver. Non-read-only
/// connections fall straight through to `client_for`.
///
/// IntelliShell writes never reach this function — the shell talks to the driver
/// directly — so they are gated separately by `shell::bridge::op_writes`, which
/// refuses write methods, write `runCommand`s and `$out`/`$merge` pipelines. Both
/// paths must stay in step: a new mutating command belongs here, a new shell
/// operation belongs there.
pub(crate) async fn client_for_write(
    pool: &ConnectionPool,
    storage: &Storage,
    id: &str,
) -> Result<Client, AppError> {
    let config = match storage.find(id) {
        Some(val) => val,
        None => return Err(AppError::UnknownConnection(id.to_string())),
    };
    if config.read_only {
        return Err(AppError::ReadOnly { name: config.name.clone() });
    }
    client_for(pool, storage, id).await
}

/// The two connection-facing managed states bundled behind one `State`: every
/// command that touches a live MongoDB connection takes a single
/// `ctx: State<'_, AppContext>` instead of the `pool` + `storage` pair, and
/// resolves its client/collection through the convenience methods below.
pub struct AppContext {
    pub pool: ConnectionPool,
    pub storage: Storage,
}

impl AppContext {
    /// Resolve the live client for a saved connection — the method form of
    /// `client_for`, which stays the single place the config-lookup + connect
    /// dance lives.
    pub async fn client(&self, id: &str) -> Result<Client, AppError> {
        client_for(&self.pool, &self.storage, id).await
    }

    /// The write-gated form of `client` — the method form of `client_for_write`.
    /// Mutating commands resolve their client through here so a read-only
    /// connection is refused before any write reaches the driver.
    pub async fn client_for_write(&self, id: &str) -> Result<Client, AppError> {
        client_for_write(&self.pool, &self.storage, id).await
    }

    /// Resolve straight to a collection handle for the common
    /// connection → database → collection path.
    pub async fn collection(
        &self,
        id: &str,
        database: &str,
        collection: &str,
    ) -> Result<Collection<bson::Document>, AppError> {
        let client = self.client(id).await?;
        Ok(client
            .database(database)
            .collection::<bson::Document>(collection))
    }

    /// The write-gated form of `collection`: resolves the collection handle through
    /// `client_for_write`, so a read-only connection is refused before the write.
    pub async fn collection_for_write(
        &self,
        id: &str,
        database: &str,
        collection: &str,
    ) -> Result<Collection<bson::Document>, AppError> {
        let client = self.client_for_write(id).await?;
        Ok(client
            .database(database)
            .collection::<bson::Document>(collection))
    }
}

#[derive(Serialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub collections: Vec<String>,
    pub accessible: bool,
}

// Numeric BSON field as i64, whatever numeric type the server used. Server stats
// documents are inconsistent about Int32/Int64/Double for the same field, so every
// reader goes through this rather than matching on one type.
pub(crate) fn bson_as_i64(value: Option<&bson::Bson>) -> Option<i64> {
    match value {
        Some(bson::Bson::Int32(v)) => Some(*v as i64),
        Some(bson::Bson::Int64(v)) => Some(*v),
        Some(bson::Bson::Double(v)) => Some(*v as i64),
        _ => None,
    }
}


#[cfg(test)]
mod tests;
