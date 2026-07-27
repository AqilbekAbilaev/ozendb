use crate::error::AppError;
use mongodb::bson;
use tauri::State;
use crate::resolve;
use crate::resolve_mongo;

use super::{
    AppContext
};
use super::collect_values;

// Build the `profile` admin command for a database. Pure, so it's unit-tested; an
// out-of-range level (only 0/1/2 are valid MongoDB profiling levels) is rejected
// rather than sending a bogus command.
pub(crate) fn profile_command(level: i32, slowms: i32) -> Result<bson::Document, String> {
    match level {
        0 | 1 | 2 => Ok(bson::doc! { "profile": level, "slowms": slowms }),
        other => Err(format!("Invalid profiling level: {other} (expected 0, 1, or 2)")),
    }
}

/// Read the current profiling status for a database by running `{ profile: -1 }`,
/// which reports the level and slowms threshold without changing them. Read path.
#[tauri::command]
pub async fn get_profiling_status(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
) -> Result<serde_json::Value, AppError> {
    let client = resolve!(ctx.client(&id).await);
    let result = match client
        .database(&database)
        .run_command(bson::doc! { "profile": -1 })
        .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
    Ok(serde_json::Value::from(bson::Bson::Document(result)))
}

/// Set the profiling level and slow-op threshold for a database. Write-gated
/// through `client_for_write`, so a read-only connection is refused before the
/// command reaches the server.
#[tauri::command]
pub async fn set_profiling_level(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    level: i32,
    slowms: i32,
) -> Result<serde_json::Value, AppError> {
    let command = match profile_command(level, slowms) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Bson(e)),
    };
    let client = resolve!(ctx.client_for_write(&id).await);
    let result = resolve_mongo!(client.database(&database).run_command(command).await);
    Ok(serde_json::Value::from(bson::Bson::Document(result)))
}

/// List captured slow operations from a database's `system.profile` capped
/// collection, newest first. An optional `slower_than_ms` keeps only ops that took
/// at least that many milliseconds. When profiling was never enabled the collection
/// doesn't exist, but a find against a missing collection just yields no documents,
/// so an empty array falls out naturally. Read path.
#[tauri::command]
pub async fn list_profile(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    limit: i64,
    slower_than_ms: Option<i64>,
) -> Result<serde_json::Value, AppError> {
    let client = resolve!(ctx.client(&id).await);
    let col = client
        .database(&database)
        .collection::<bson::Document>("system.profile");
    let filter = match slower_than_ms {
        Some(ms) => bson::doc! { "millis": { "$gte": ms } },
        None => bson::doc! {},
    };
    let mut cursor = match col
        .find(filter)
        .sort(bson::doc! { "ts": -1 })
        .limit(limit)
        .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
    let values = resolve!(collect_values(&mut cursor).await);
    Ok(serde_json::Value::Array(values))
}

#[cfg(test)]
#[path = "profiler.test.rs"]
mod tests;
