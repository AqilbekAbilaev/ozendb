use crate::error::AppError;
use mongodb::bson;
use tauri::State;
use crate::resolve;
use crate::resolve_mongo;

use super::{
    AppContext
};

// Map a UI "kind" to the admin diagnostic command to run. Pure, so it's
// unit-tested; an unknown kind is rejected rather than sending a bogus command.
pub(crate) fn info_command(kind: &str) -> Result<bson::Document, String> {
    match kind {
        "build" => Ok(bson::doc! { "buildInfo": 1 }),
        "host" => Ok(bson::doc! { "hostInfo": 1 }),
        "replica" => Ok(bson::doc! { "replSetGetStatus": 1 }),
        other => Err(format!("Unknown server info kind: {other}")),
    }
}

/// Run a read-only server diagnostic on the admin database and return the raw
/// result. `kind` is one of "build" (buildInfo), "host" (hostInfo), or "replica"
/// (replSetGetStatus). Mirrors the extra entries in Studio-3T's Server Info menu.
#[tauri::command]
pub async fn server_info(
    ctx: State<'_, AppContext>,
    id: String,
    kind: String,
) -> Result<serde_json::Value, AppError> {
    let command = match info_command(&kind) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Bson(e)),
    };
    let client = resolve!(ctx.client(&id).await);
    let result = resolve_mongo!(client.database("admin").run_command(command).await);
    Ok(serde_json::Value::from(bson::Bson::Document(result)))
}

#[cfg(test)]
#[path = "serverinfo.test.rs"]
mod tests;
