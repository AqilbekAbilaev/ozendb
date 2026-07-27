use crate::error::AppError;
use crate::operations::{OpMeta, OperationsRegistry};
use mongodb::bson;
use serde::Serialize;
use tauri::State;

use super::portmap::{apply_field_map, FieldMap};

use super::{
    collect_values, parse_ejson_document, parse_pipeline, tracked, DatabaseInfo, AppContext,
};

/// Build operation metadata for a long-running admin command — data movement
/// (export/import/…) or an index build/drop, all of which can run for a long time on
/// a large collection. These are always worth logging, so — unlike queries — there's
/// no gating. No cancel handle yet (server-side cancellation is a later phase).
fn data_op_meta(
    ctx: &AppContext,
    op_type: &str,
    label: String,
    id: &str,
    database: &str,
    collection: &str,
) -> OpMeta {
    OpMeta {
        op_type: op_type.to_string(),
        label: label,
        connection_id: Some(id.to_string()),
        conn_name: ctx.storage.find(id).map(|config| config.name),
        database: Some(database.to_string()),
        collection: Some(collection.to_string()),
    }
}

/// The `_id_` index is created and required by MongoDB and can never be dropped,
/// hidden, or otherwise modified. The index-management guards share this check so
/// the rule lives in one place (kept pure so it can be unit-tested).
pub fn is_protected_index(name: &str) -> bool {
    name == "_id_"
}

#[tauri::command]
pub async fn list_databases(
    ctx: State<'_, AppContext>,
    id: String,
) -> Result<Vec<DatabaseInfo>, AppError> {
    let client = ctx.client(&id).await?;

    let db_names = client.list_database_names().await?;
    let mut databases = Vec::new();
    for name in db_names {
        let collections = match client.database(&name).list_collection_names().await {
            Ok(val) => val,
            Err(_) => {
                databases.push(DatabaseInfo {
                    name: name,
                    collections: Vec::new(),
                    accessible: false,
                });
                continue;
            }
        };
        databases.push(DatabaseInfo {
            name: name,
            collections: collections,
            accessible: true,
        });
    }
    Ok(databases)
}

/// Optional collection-creation settings, mirroring Studio 3T's Add Collection dialog.
/// A `None` `options` argument (or an all-empty struct) creates a plain collection, so
/// existing callers that pass only `{ id, database, name }` are unaffected. Serde treats
/// each missing field as its default, so the frontend only sends what the user chose.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCollectionOptions {
    // Capped collection: a fixed-size ring buffer. `size` (bytes) is required by MongoDB
    // when `capped` is true; `max` (document count) is an optional extra cap.
    #[serde(default)]
    pub capped: bool,
    pub size: Option<i64>,
    pub max: Option<i64>,
    // Time-series collection (MongoDB 5.0+): the presence of `time_field` turns it on.
    // `meta_field` and `granularity` ("seconds" | "minutes" | "hours") are optional;
    // `expire_after_seconds` sets automatic expiry of old buckets.
    pub time_field: Option<String>,
    pub meta_field: Option<String>,
    pub granularity: Option<String>,
    pub expire_after_seconds: Option<i64>,
    // Clustered collection (MongoDB 5.3+): documents stored in `_id` order. MongoDB only
    // allows a clustered index on `{ _id: 1 }` with `unique: true`, so the frontend just
    // sets the flag plus an optional index name.
    #[serde(default)]
    pub clustered: bool,
    pub clustered_index_name: Option<String>,
}

#[tauri::command]
pub async fn create_collection(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    name: String,
    options: Option<NewCollectionOptions>,
) -> Result<(), AppError> {
    // Build the `create` command up front so a bad request (e.g. capped without a size)
    // fails fast with a clear message before we touch the connection.
    let command = match build_create_command(&name, options) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let client = ctx.client_for_write(&id).await?;
    client.database(&database).run_command(command).await?;
    Ok(())
}

/// Assemble the `create` command document from the requested options. Kept separate and
/// pure so the option-to-command mapping can be unit-tested without a live server.
fn build_create_command(
    name: &str,
    options: Option<NewCollectionOptions>,
) -> Result<bson::Document, AppError> {
    let mut command = bson::doc! { "create": name };
    let options = match options {
        Some(val) => val,
        None => return Ok(command),
    };

    if options.capped {
        let size = match options.size {
            Some(val) if val > 0 => val,
            _ => {
                return Err(AppError::Validation(
                    "A capped collection needs a maximum size in bytes.".to_string(),
                ))
            }
        };
        command.insert("capped", true);
        command.insert("size", size);
        if let Some(max) = options.max {
            if max > 0 {
                command.insert("max", max);
            }
        }
    }

    if let Some(time_field) = options.time_field {
        let trimmed = time_field.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation(
                "A time-series collection needs a time field.".to_string(),
            ));
        }
        let mut timeseries = bson::doc! { "timeField": trimmed };
        if let Some(meta_field) = options.meta_field {
            if !meta_field.trim().is_empty() {
                timeseries.insert("metaField", meta_field.trim());
            }
        }
        if let Some(granularity) = options.granularity {
            if !granularity.trim().is_empty() {
                timeseries.insert("granularity", granularity.trim());
            }
        }
        command.insert("timeseries", timeseries);
        if let Some(expire) = options.expire_after_seconds {
            if expire > 0 {
                command.insert("expireAfterSeconds", expire);
            }
        }
    }

    if options.clustered {
        let mut clustered_index = bson::doc! {
            "key": bson::doc! { "_id": 1 },
            "unique": true,
        };
        if let Some(index_name) = options.clustered_index_name {
            if !index_name.trim().is_empty() {
                clustered_index.insert("name", index_name.trim());
            }
        }
        command.insert("clusteredIndex", clustered_index);
    }

    Ok(command)
}

/// Create a view: a read-only collection defined by an aggregation `pipeline` over a
/// source collection (`view_on`). Uses the `create` command with viewOn + pipeline.
#[tauri::command]
pub async fn create_view(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    name: String,
    view_on: String,
    pipeline: String,
) -> Result<(), AppError> {
    // Parse and validate the pipeline before opening a connection, so a bad pipeline
    // fails fast with a clear message rather than a driver error.
    let stages = match parse_pipeline(&pipeline) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let client = ctx.client_for_write(&id).await?;
    let pipeline_bson: Vec<bson::Bson> = stages.into_iter().map(bson::Bson::Document).collect();
    let command = bson::doc! {
        "create": &name,
        "viewOn": &view_on,
        "pipeline": pipeline_bson,
    };
    client.database(&database).run_command(command).await?;
    Ok(())
}

// The current schema-validation settings for a collection, read from its options so
// the editor can prefill rather than silently overwrite an existing rule.
#[derive(Serialize)]
pub struct ValidatorInfo {
    pub validator: Option<String>,          // the validator document as pretty JSON, if any
    pub validation_level: Option<String>,   // "off" | "moderate" | "strict"
    pub validation_action: Option<String>,  // "error" | "warn"
}

/// Read a collection's current schema validator (via `listCollections`) so the
/// validator editor can prefill. Returns empty fields when no validator is set.
#[tauri::command]
pub async fn get_validator(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
) -> Result<ValidatorInfo, AppError> {
    let client = ctx.client(&id).await?;
    let command = bson::doc! { "listCollections": 1, "filter": { "name": &collection } };
    let result = client.database(&database).run_command(command).await?;
    let empty = ValidatorInfo {
        validator: None,
        validation_level: None,
        validation_action: None,
    };
    // Navigate result.cursor.firstBatch[0].options, tolerating any missing level.
    let cursor = match result.get("cursor") {
        Some(bson::Bson::Document(doc)) => doc,
        _ => return Ok(empty),
    };
    let first_batch = match cursor.get("firstBatch") {
        Some(bson::Bson::Array(arr)) => arr,
        _ => return Ok(empty),
    };
    let entry = match first_batch.first() {
        Some(bson::Bson::Document(doc)) => doc,
        _ => return Ok(empty),
    };
    let options = match entry.get("options") {
        Some(bson::Bson::Document(doc)) => doc,
        _ => return Ok(empty),
    };
    let validator = match options.get("validator") {
        Some(bson::Bson::Document(doc)) if !doc.is_empty() => {
            let value = serde_json::Value::from(bson::Bson::Document(doc.clone()));
            match serde_json::to_string_pretty(&value) {
                Ok(text) => Some(text),
                Err(_) => None,
            }
        }
        _ => None,
    };
    let validation_level = match options.get("validationLevel") {
        Some(bson::Bson::String(text)) => Some(text.clone()),
        _ => None,
    };
    let validation_action = match options.get("validationAction") {
        Some(bson::Bson::String(text)) => Some(text.clone()),
        _ => None,
    };
    Ok(ValidatorInfo {
        validator: validator,
        validation_level: validation_level,
        validation_action: validation_action,
    })
}

/// Set (or clear) a collection's schema validator via `collMod`. An empty validator
/// clears the rule. `validation_level`/`validation_action` are passed through.
#[tauri::command]
pub async fn set_validator(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
    validator: String,
    validation_level: String,
    validation_action: String,
) -> Result<(), AppError> {
    // Parse the validator up front; an empty string clears the rule (validator: {}).
    let validator_doc = if validator.trim().is_empty() || validator.trim() == "{}" {
        bson::Document::new()
    } else {
        parse_ejson_document(&validator)?
    };
    let client = ctx.client_for_write(&id).await?;
    let command = bson::doc! {
        "collMod": &collection,
        "validator": validator_doc,
        "validationLevel": &validation_level,
        "validationAction": &validation_action,
    };
    client.database(&database).run_command(command).await?;
    Ok(())
}

#[tauri::command]
pub async fn drop_database(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
) -> Result<(), AppError> {
    let client = ctx.client_for_write(&id).await?;
    client.database(&database).drop().await?;
    Ok(())
}

#[tauri::command]
pub async fn drop_collection(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
) -> Result<(), AppError> {
    let client = ctx.client_for_write(&id).await?;
    let col = client
        .database(&database)
        .collection::<bson::Document>(&collection);
    col.drop().await?;
    Ok(())
}

#[tauri::command]
pub async fn rename_collection(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
    new_name: String,
) -> Result<(), AppError> {
    let client = ctx.client_for_write(&id).await?;
    // MongoDB has no per-collection rename helper; the admin `renameCollection`
    // command takes fully-qualified `db.collection` namespaces for both sides.
    let from_namespace = format!("{}.{}", database, collection);
    let to_namespace = format!("{}.{}", database, new_name);
    let command = bson::doc! {
        "renameCollection": from_namespace,
        "to": to_namespace,
    };
    client.database("admin").run_command(command).await?;
    Ok(())
}

#[tauri::command]
pub async fn create_database(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    first_collection: String,
) -> Result<(), AppError> {
    let client = ctx.client_for_write(&id).await?;
    // A MongoDB database only materializes once it holds content, so creating the
    // first collection is what actually brings the database into existence.
    match client
        .database(&database)
        .create_collection(&first_collection)
        .await
    {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Mongo(e)),
    }
}

/// Run admin `serverStatus` for a connection — host, version, uptime, current
/// connections, memory, etc. Returned raw as JSON; the frontend surfaces the
/// headline fields it cares about.
#[tauri::command]
pub async fn server_status(
    ctx: State<'_, AppContext>,
    id: String,
) -> Result<serde_json::Value, AppError> {
    let client = ctx.client(&id).await?;
    let command = bson::doc! { "serverStatus": 1 };
    let result = client.database("admin").run_command(command).await?;
    Ok(serde_json::Value::from(bson::Bson::Document(result)))
}

/// Run `dbStats` for a database — collection/object counts and data/storage/index
/// sizes. Returned raw as JSON; the frontend surfaces the headline fields.
#[tauri::command]
pub async fn database_stats(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
) -> Result<serde_json::Value, AppError> {
    let client = ctx.client(&id).await?;
    let command = bson::doc! { "dbStats": 1 };
    let result = client.database(&database).run_command(command).await?;
    Ok(serde_json::Value::from(bson::Bson::Document(result)))
}

/// Run admin `currentOp` for a connection — the operations currently in progress on
/// the server. Returned raw as JSON; the frontend lists the `inprog` array.
#[tauri::command]
pub async fn current_ops(
    ctx: State<'_, AppContext>,
    id: String,
) -> Result<serde_json::Value, AppError> {
    let client = ctx.client(&id).await?;
    let command = bson::doc! { "currentOp": 1 };
    let result = client.database("admin").run_command(command).await?;
    Ok(serde_json::Value::from(bson::Bson::Document(result)))
}

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

#[tauri::command]
pub async fn export_collection(
    ctx: State<'_, AppContext>,
    ops: State<'_, OperationsRegistry>,
    id: String,
    database: String,
    collection: String,
    path: String,
    format: String,
) -> Result<usize, AppError> {
    let meta = data_op_meta(
        &ctx,
        "export",
        format!("Export {}.{} ({})", database, collection, format),
        &id,
        &database,
        &collection,
    );
    let run = async {
        let client = ctx.client(&id).await?;
        let col = client
            .database(&database)
            .collection::<bson::Document>(&collection);
        // Plain export: no filter, no limit, no time cap (a large export legitimately
        // takes a while), no per-document transform.
        super::stream_export(
            &col,
            bson::doc! {},
            None,
            None,
            &path,
            &format,
            |_doc: &mut bson::Document| -> Result<(), AppError> { Ok(()) },
        )
        .await
    };
    tracked(&ops, Some(meta), run).await
}

#[tauri::command]
pub async fn import_collection(
    ctx: State<'_, AppContext>,
    ops: State<'_, OperationsRegistry>,
    id: String,
    database: String,
    collection: String,
    path: String,
    format: String,
) -> Result<usize, AppError> {
    let meta = data_op_meta(
        &ctx,
        "import",
        format!("Import {}.{} ({})", database, collection, format),
        &id,
        &database,
        &collection,
    );
    let run = async {
        let client = ctx.client_for_write(&id).await?;
        let col = client
            .database(&database)
            .collection::<bson::Document>(&collection);
        // Stream the file in bounded batches instead of loading + parsing + inserting the
        // whole thing at once, so a large import can't exhaust memory. `None` mapping =
        // insert documents exactly as parsed.
        super::stream_import(&col, &path, &format, None, super::CsvOptions::default()).await
    };
    tracked(&ops, Some(meta), run).await
}

/// Field-mapping import for the Import/Export wizard: same streaming import as
/// `import_collection`, but each parsed document is rewritten through `mapping`
/// (rename source→target, coerce per-field type, drop unmapped columns) before
/// insertion. An empty `mapping` falls back to a plain import. Returns the number
/// of documents inserted.
#[tauri::command]
pub async fn import_collection_mapped(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
    path: String,
    format: String,
    mapping: Vec<FieldMap>,
    csv: Option<super::CsvOptionsInput>,
) -> Result<usize, AppError> {
    let client = ctx.client_for_write(&id).await?;
    let col = client
        .database(&database)
        .collection::<bson::Document>(&collection);
    let mapping_opt = if mapping.is_empty() {
        None
    } else {
        Some(mapping)
    };
    let csv_options = match csv {
        Some(input) => input.to_options(),
        None => super::CsvOptions::default(),
    };
    super::stream_import(&col, &path, &format, mapping_opt, csv_options).await
}

// Serialize an `_id` to a stable string for the incremental-export watermark store, as
// canonical Extended JSON so any id type (ObjectId, int, string) round-trips.
fn watermark_to_string(id: &bson::Bson) -> String {
    id.clone().into_canonical_extjson().to_string()
}

// Parse a stored watermark string back to a Bson `_id`. Returns None if the stored value
// is unreadable (e.g. corrupted), which callers treat as "no previous export".
fn watermark_from_string(text: &str) -> Option<bson::Bson> {
    match serde_json::from_str::<bson::Bson>(text) {
        Ok(val) => Some(val),
        Err(_) => None,
    }
}

// Build the incremental-export filter: `_id` up to and including `boundary`, and — when a
// previous watermark exists — strictly greater than it. Keeps the exported window bounded
// so documents inserted mid-export are picked up by the next run, not skipped.
fn incremental_filter(previous: Option<&bson::Bson>, boundary: &bson::Bson) -> bson::Document {
    match previous {
        Some(prev) => bson::doc! {
            "_id": { "$gt": prev.clone(), "$lte": boundary.clone() }
        },
        None => bson::doc! {
            "_id": { "$lte": boundary.clone() }
        },
    }
}

/// Field-selecting export for the Import/Export wizard: same streaming export as
/// `export_collection`, but each document is rewritten through `fields`
/// (select/reorder/rename, with optional per-field coercion) before it's written.
/// The field order drives the output column/key order. An empty `fields` exports
/// every field unchanged. When `incremental` is true, only documents added since the
/// last incremental export of this collection are written (watermarked by `_id`).
/// Returns the number of documents written.
#[tauri::command]
pub async fn export_collection_fields(
    ctx: State<'_, AppContext>,
    watermarks: State<'_, crate::export_watermarks::ExportWatermarkStorage>,
    id: String,
    database: String,
    collection: String,
    path: String,
    format: String,
    fields: Vec<FieldMap>,
    incremental: Option<bool>,
) -> Result<usize, AppError> {
    let client = ctx.client(&id).await?;
    let col = client
        .database(&database)
        .collection::<bson::Document>(&collection);

    let use_incremental = incremental.unwrap_or(false);
    let watermark_key = format!("{}/{}/{}", id, database, collection);

    // For an incremental export, work out the id window before streaming.
    let mut filter = bson::doc! {};
    let mut new_watermark: Option<bson::Bson> = None;
    if use_incremental {
        // The boundary is the current maximum `_id`; nothing beyond it is exported, so a
        // document inserted after this point is left for the next run.
        let boundary = max_id(&col).await?;
        let boundary = match boundary {
            Some(val) => val,
            // Empty collection → nothing to export, and no watermark to advance.
            None => return Ok(0),
        };
        let previous = match watermarks.get(&watermark_key) {
            Some(text) => watermark_from_string(&text),
            None => None,
        };
        filter = incremental_filter(previous.as_ref(), &boundary);
        new_watermark = Some(boundary);
    }

    let count = match super::stream_export(
        &col,
        filter,
        None,
        None,
        &path,
        &format,
        move |doc: &mut bson::Document| -> Result<(), AppError> {
            // No fields chosen → leave the document untouched (export everything).
            if !fields.is_empty() {
                *doc = apply_field_map(doc, &fields);
            }
            Ok(())
        },
    )
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(e),
    };

    // Only advance the watermark after a successful export, so a failed write doesn't
    // skip documents on the next run.
    if let Some(boundary) = new_watermark {
        match watermarks.set(&watermark_key, &watermark_to_string(&boundary)) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }

    Ok(count)
}

// The largest `_id` currently in a collection (via `find().sort(_id:-1).limit(1)`), or
// None if the collection is empty. Used as the boundary for an incremental export.
async fn max_id(
    col: &mongodb::Collection<bson::Document>,
) -> Result<Option<bson::Bson>, AppError> {
    let sort = bson::doc! { "_id": -1 };
    let found = col.find_one(bson::doc! {}).sort(sort).await?;
    match found {
        Some(doc) => Ok(doc.get("_id").cloned()),
        None => Ok(None),
    }
}

#[cfg(test)]
#[path = "admin.test.rs"]
mod tests;
