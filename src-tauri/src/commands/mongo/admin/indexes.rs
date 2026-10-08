use crate::error::AppError;
use crate::operations::OperationsRegistry;
use mongodb::bson;
use tauri::State;

use super::{collect_values, data_op_meta, is_protected_index, parse_ejson_document, tracked, AppContext};

#[tauri::command]
pub async fn list_indexes(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
) -> Result<Vec<serde_json::Value>, AppError> {
    let client = ctx.client(&id).await?;
    // `listIndexes` returns the raw index documents (key spec, name, unique, …)
    // inside a cursor envelope; the frontend only needs the first batch to display.
    let command = bson::doc! { "listIndexes": collection };
    let result = client.database(&database).run_command(command).await?;
    let cursor_doc = match result.get_document("cursor") {
        Ok(val) => val,
        Err(e) => return Err(AppError::Bson(e.to_string())),
    };
    let first_batch = match cursor_doc.get_array("firstBatch") {
        Ok(val) => val,
        Err(e) => return Err(AppError::Bson(e.to_string())),
    };
    let mut indexes = Vec::new();
    for entry in first_batch {
        indexes.push(serde_json::Value::from(entry.clone()));
    }
    Ok(indexes)
}

/// Creates an index from a raw key spec plus an options document. `options` is any
/// index-options JSON the UI assembled — `name`, `unique`, `sparse`,
/// `expireAfterSeconds`, `partialFilterExpression`, `collation`, text `weights`,
/// geo tuning, `background`, `hidden`, … — so the JSON escape hatch and every form
/// tab share one path and new options need no backend change. The `key` field is set
/// from `keys` and always wins over any `key` in `options`. An empty `options`
/// document (and no `name`) lets MongoDB auto-generate the name.
#[tauri::command]
pub async fn create_index(
    ctx: State<'_, AppContext>,
    ops: State<'_, OperationsRegistry>,
    id: String,
    database: String,
    collection: String,
    keys: String,
    options: String,
) -> Result<(), AppError> {
    // Building an index on a large collection can take a long time, so record it in
    // the Operations pane like export/import rather than blocking silently.
    let meta = data_op_meta(
        &ctx,
        "index",
        format!("Create index on {}.{}", database, collection),
        &id,
        &database,
        &collection,
    );
    let run = async {
        let client = ctx.client_for_write(&id).await?;
        let keys_doc = parse_ejson_document(&keys)?;
    let mut index_doc = parse_ejson_document(&options)?;
        index_doc.insert("key", keys_doc);
        let command = bson::doc! {
            "createIndexes": &collection,
            "indexes": [index_doc],
        };
        client.database(&database).run_command(command).await?;
        Ok(())
    };
    tracked(&ops, Some(meta), run).await
}

#[tauri::command]
pub async fn drop_index(
    ctx: State<'_, AppContext>,
    ops: State<'_, OperationsRegistry>,
    id: String,
    database: String,
    collection: String,
    name: String,
) -> Result<(), AppError> {
    // The `_id_` index cannot be dropped; reject it before touching the network (and
    // before creating an operation record — a blocked attempt isn't a real op).
    if is_protected_index(&name) {
        return Err(AppError::Validation(format!(
            "The \"{}\" index cannot be dropped.",
            name
        )));
    }
    // Dropping an index on a large collection can also run for a while, so track it.
    let meta = data_op_meta(
        &ctx,
        "index",
        format!("Drop index \"{}\" on {}.{}", name, database, collection),
        &id,
        &database,
        &collection,
    );
    let run = async {
        let client = ctx.client_for_write(&id).await?;
        let col = client
            .database(&database)
            .collection::<bson::Document>(&collection);
        col.drop_index(name).await?;
        Ok(())
    };
    tracked(&ops, Some(meta), run).await
}

/// Sets or clears an index's `hidden` flag via `collMod`. A hidden index is
/// ignored by the query planner but kept up to date, so it can be un-hidden
/// instantly without a rebuild. The `_id_` index cannot be hidden.
#[tauri::command]
pub async fn set_index_hidden(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
    name: String,
    hidden: bool,
) -> Result<(), AppError> {
    if is_protected_index(&name) {
        return Err(AppError::Validation(format!(
            "The \"{}\" index cannot be hidden.",
            name
        )));
    }
    let client = ctx.client_for_write(&id).await?;
    let command = bson::doc! {
        "collMod": &collection,
        "index": { "name": &name, "hidden": hidden },
    };
    client.database(&database).run_command(command).await?;
    Ok(())
}

/// Returns the `$indexStats` usage entries for a collection (one per index, with
/// access counts and the time tracking began). Used by the index "View Details"
/// view; the frontend matches entries to indexes by name. Callers treat an error
/// as "stats unavailable" (e.g. on a server/deployment that doesn't support it).
#[tauri::command]
pub async fn index_stats(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
) -> Result<Vec<serde_json::Value>, AppError> {
    let client = ctx.client(&id).await?;
    let col = client
        .database(&database)
        .collection::<bson::Document>(&collection);
    let pipeline = vec![bson::doc! { "$indexStats": {} }];
    let mut cursor = match col.aggregate(pipeline).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
    collect_values(&mut cursor).await
}

