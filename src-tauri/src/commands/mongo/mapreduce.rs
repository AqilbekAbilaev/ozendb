use crate::error::AppError;
use mongodb::bson;
use tauri::State;


use super::{
    AppContext
};

/// Run a `mapReduce` over a collection. `map`/`reduce` (and optional `finalize`) are
/// JavaScript function sources. An empty `out_collection` runs inline (results
/// returned); otherwise results are written to that collection. The raw result
/// document is returned as JSON.
#[tauri::command]
pub async fn map_reduce(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
    map: String,
    reduce: String,
    finalize: String,
    out_collection: String,
) -> Result<serde_json::Value, AppError> {
    // An empty `out_collection` runs inline (read-only); a named one writes the
    // results to that collection, so gate that case on the connection being writable.
    let writes = !out_collection.trim().is_empty();
    let client = if writes {
        ctx.client_for_write(&id).await?
    } else {
        ctx.client(&id).await?
    };
    let out: bson::Bson = if out_collection.trim().is_empty() {
        bson::Bson::Document(bson::doc! { "inline": 1 })
    } else {
        bson::Bson::String(out_collection.trim().to_string())
    };
    let mut command = bson::doc! {
        "mapReduce": &collection,
        "map": bson::Bson::JavaScriptCode(map),
        "reduce": bson::Bson::JavaScriptCode(reduce),
        "out": out,
    };
    if !finalize.trim().is_empty() {
        command.insert("finalize", bson::Bson::JavaScriptCode(finalize));
    }
    let result = client.database(&database).run_command(command).await?;
    Ok(serde_json::Value::from(bson::Bson::Document(result)))
}
