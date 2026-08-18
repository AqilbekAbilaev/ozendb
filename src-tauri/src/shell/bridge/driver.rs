use mongodb::bson;
use mongodb::options::IndexOptions;
use mongodb::{Client, Collection, IndexModel};
use tokio::runtime::Handle;

use super::{op_writes, DEFAULT_FIND_LIMIT, MAX_DOCS, MAX_QUERY_TIME};

pub(super) fn run_op(
    client: &Client,
    db_name: &str,
    handle: &Handle,
    read_only: bool,
    op: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let method = match op.get("method").and_then(|value| value.as_str()) {
        Some(value) => value,
        None => return Err(String::from("operation has no method")),
    };

    let empty: Vec<serde_json::Value> = Vec::new();
    let args = match op.get("args").and_then(|value| value.as_array()) {
        Some(value) => value,
        None => &empty,
    };

    if read_only && op_writes(method, args) {
        return Err(String::from(
            "This connection is read-only — writes are disabled in the shell.",
        ));
    }
    let database = client.database(db_name);

    handle.block_on(async {
        if method == "runCommand" {
            let command = match arg_doc(args, 0) {
                Ok(doc) => doc,
                Err(e) => return Err(e),
            };
            return match database.run_command(command).await {
                Ok(doc) => Ok(bson_doc_to_json(doc)),
                Err(e) => Err(e.to_string()),
            };
        }

        let collection_name = match op.get("collection").and_then(|value| value.as_str()) {
            Some(value) => value,
            None => return Err(String::from("operation has no collection")),
        };
        let collection = database.collection::<bson::Document>(collection_name);

        match method {
            "find" => exec_find(&collection, args).await,
            "findOne" => exec_find_one(&collection, args).await,
            "insertOne" => exec_insert_one(&collection, args).await,
            "insertMany" => exec_insert_many(&collection, args).await,
            "updateOne" => exec_update(&collection, args, false).await,
            "updateMany" => exec_update(&collection, args, true).await,
            "replaceOne" => exec_replace_one(&collection, args).await,
            "deleteOne" => exec_delete(&collection, args, false).await,
            "deleteMany" => exec_delete(&collection, args, true).await,
            "countDocuments" => exec_count(&collection, args).await,
            "estimatedDocumentCount" => exec_estimated_count(&collection).await,
            "distinct" => exec_distinct(&collection, args).await,
            "aggregate" => exec_aggregate(&collection, args).await,
            "drop" => exec_drop(&collection).await,
            "createIndex" => exec_create_index(&collection, args).await,
            "dropIndex" => exec_drop_index(&collection, args).await,
            "renameCollection" => {
                exec_rename(client, db_name, collection_name, args).await
            }
            other => Err(format!("unsupported shell method: {}", other)),
        }
    })
}

// ── argument / result conversion ──────────────────────────────────────────

/// Decode a JS-object argument into a BSON document. Uses bson's serde Extended
/// JSON decoding — the same mechanism as `commands::parse_ejson_document`, so
/// `ObjectId("…")` / `{ $oid }` and friends round-trip correctly.
pub(super) fn to_document(value: &serde_json::Value) -> Result<bson::Document, String> {
    match serde_json::from_value::<bson::Bson>(value.clone()) {
        Ok(bson::Bson::Document(doc)) => Ok(doc),
        Ok(bson::Bson::Null) => Ok(bson::Document::new()),
        Ok(_) => Err(String::from("expected a document argument")),
        Err(e) => Err(e.to_string()),
    }
}

/// Document argument at `index`, defaulting to an empty document when absent.
pub(super) fn arg_doc(args: &[serde_json::Value], index: usize) -> Result<bson::Document, String> {
    match args.get(index) {
        Some(value) => to_document(value),
        None => Ok(bson::Document::new()),
    }
}

/// BSON → EJSON-preserving JSON (same conversion the find/aggregate commands use).
fn bson_doc_to_json(doc: bson::Document) -> serde_json::Value {
    serde_json::Value::from(bson::Bson::Document(doc))
}

// ── per-method executors ──────────────────────────────────────────────────

async fn exec_find(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    let mut query = collection.find(filter);

    // Positional args from the cursor: [filter, projection, sort, skip, limit].
    let projection = match arg_doc(args, 1) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    if !projection.is_empty() {
        query = query.projection(projection);
    }
    let sort = match arg_doc(args, 2) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    if !sort.is_empty() {
        query = query.sort(sort);
    }
    // JS numbers may decode as floats, so read through f64 then cast.
    if let Some(skip) = args.get(3).and_then(|value| value.as_f64()) {
        if skip > 0.0 {
            query = query.skip(skip as u64);
        }
    }
    // Default to a small batch when no limit is set; never fetch beyond MAX_DOCS.
    let requested = args
        .get(4)
        .and_then(|value| value.as_f64())
        .map(|value| value as i64)
        .unwrap_or(0);
    let effective_limit = if requested <= 0 {
        DEFAULT_FIND_LIMIT
    } else {
        requested.min(MAX_DOCS as i64)
    };
    query = query.limit(effective_limit).max_time(MAX_QUERY_TIME);

    let mut cursor = match query.await {
        Ok(value) => value,
        Err(e) => return Err(e.to_string()),
    };
    let mut docs = Vec::new();
    loop {
        let has_next = match cursor.advance().await {
            Ok(value) => value,
            Err(e) => return Err(e.to_string()),
        };
        if !has_next {
            break;
        }
        let doc: bson::Document = match cursor.deserialize_current() {
            Ok(value) => value,
            Err(e) => return Err(e.to_string()),
        };
        docs.push(bson_doc_to_json(doc));
    }
    Ok(serde_json::Value::Array(docs))
}

async fn exec_find_one(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    let mut query = collection.find_one(filter);
    if args.len() > 1 {
        let projection = match arg_doc(args, 1) {
            Ok(doc) => doc,
            Err(e) => return Err(e),
        };
        if !projection.is_empty() {
            query = query.projection(projection);
        }
    }
    match query.await {
        Ok(Some(doc)) => Ok(bson_doc_to_json(doc)),
        Ok(None) => Ok(serde_json::Value::Null),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_insert_one(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let doc = match arg_doc(args, 0) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    let result = match collection.insert_one(doc).await {
        Ok(value) => value,
        Err(e) => return Err(e.to_string()),
    };
    let mut out = serde_json::Map::new();
    out.insert(String::from("acknowledged"), serde_json::Value::Bool(true));
    out.insert(
        String::from("insertedId"),
        serde_json::Value::from(result.inserted_id),
    );
    Ok(serde_json::Value::Object(out))
}

async fn exec_insert_many(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let array = match args.first().and_then(|value| value.as_array()) {
        Some(value) => value,
        None => return Err(String::from("insertMany expects an array of documents")),
    };
    let mut docs = Vec::new();
    for item in array {
        match to_document(item) {
            Ok(doc) => docs.push(doc),
            Err(e) => return Err(e),
        }
    }
    let result = match collection.insert_many(docs).await {
        Ok(value) => value,
        Err(e) => return Err(e.to_string()),
    };
    let mut ids = serde_json::Map::new();
    for (index, id) in result.inserted_ids {
        ids.insert(index.to_string(), serde_json::Value::from(id));
    }
    let mut out = serde_json::Map::new();
    out.insert(String::from("acknowledged"), serde_json::Value::Bool(true));
    out.insert(
        String::from("insertedCount"),
        serde_json::Value::from(ids.len()),
    );
    out.insert(String::from("insertedIds"), serde_json::Value::Object(ids));
    Ok(serde_json::Value::Object(out))
}

async fn exec_update(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
    many: bool,
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    let update = match arg_doc(args, 1) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    let result = if many {
        collection.update_many(filter, update).await
    } else {
        collection.update_one(filter, update).await
    };
    match result {
        Ok(value) => Ok(update_result_to_json(value)),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_replace_one(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    let replacement = match arg_doc(args, 1) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    match collection.replace_one(filter, replacement).await {
        Ok(value) => Ok(update_result_to_json(value)),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_delete(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
    many: bool,
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    let result = if many {
        collection.delete_many(filter).await
    } else {
        collection.delete_one(filter).await
    };
    match result {
        Ok(value) => {
            let mut out = serde_json::Map::new();
            out.insert(String::from("acknowledged"), serde_json::Value::Bool(true));
            out.insert(
                String::from("deletedCount"),
                serde_json::Value::from(value.deleted_count),
            );
            Ok(serde_json::Value::Object(out))
        }
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_count(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    match collection.count_documents(filter).max_time(MAX_QUERY_TIME).await {
        Ok(value) => Ok(serde_json::Value::from(value)),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_aggregate(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let array = match args.first().and_then(|value| value.as_array()) {
        Some(value) => value,
        None => return Err(String::from("aggregate expects a pipeline array")),
    };
    let mut stages = Vec::new();
    for item in array {
        match to_document(item) {
            Ok(doc) => stages.push(doc),
            Err(e) => return Err(e),
        }
    }
    let mut cursor = match collection.aggregate(stages).max_time(MAX_QUERY_TIME).await {
        Ok(value) => value,
        Err(e) => return Err(e.to_string()),
    };
    let mut docs = Vec::new();
    loop {
        // Safety ceiling so a huge pipeline result can't exhaust memory.
        if docs.len() >= MAX_DOCS {
            break;
        }
        let has_next = match cursor.advance().await {
            Ok(value) => value,
            Err(e) => return Err(e.to_string()),
        };
        if !has_next {
            break;
        }
        let doc: bson::Document = match cursor.deserialize_current() {
            Ok(value) => value,
            Err(e) => return Err(e.to_string()),
        };
        docs.push(bson_doc_to_json(doc));
    }
    Ok(serde_json::Value::Array(docs))
}

fn update_result_to_json(result: mongodb::results::UpdateResult) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    out.insert(String::from("acknowledged"), serde_json::Value::Bool(true));
    out.insert(
        String::from("matchedCount"),
        serde_json::Value::from(result.matched_count),
    );
    out.insert(
        String::from("modifiedCount"),
        serde_json::Value::from(result.modified_count),
    );
    match result.upserted_id {
        Some(id) => {
            out.insert(String::from("upsertedId"), serde_json::Value::from(id));
        }
        None => {}
    }
    serde_json::Value::Object(out)
}

async fn exec_estimated_count(
    collection: &Collection<bson::Document>,
) -> Result<serde_json::Value, String> {
    match collection.estimated_document_count().await {
        Ok(value) => Ok(serde_json::Value::from(value)),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_distinct(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let field = match args.first().and_then(|value| value.as_str()) {
        Some(value) => value.to_string(),
        None => return Err(String::from("distinct expects a field name")),
    };
    let filter = match arg_doc(args, 1) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    match collection.distinct(field, filter).await {
        Ok(values) => {
            let array = values
                .into_iter()
                .map(serde_json::Value::from)
                .collect::<Vec<serde_json::Value>>();
            Ok(serde_json::Value::Array(array))
        }
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_drop(
    collection: &Collection<bson::Document>,
) -> Result<serde_json::Value, String> {
    match collection.drop().await {
        Ok(_) => Ok(ok_result()),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_create_index(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let keys = match arg_doc(args, 0) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    let options_doc = match args.get(1) {
        Some(value) => match to_document(value) {
            Ok(doc) => doc,
            Err(e) => return Err(e),
        },
        None => bson::Document::new(),
    };
    // The builder is typed-state, so pass Options straight through rather than
    // conditionally reassigning (absent → None, i.e. unset).
    let unique = options_doc.get("unique").and_then(|value| value.as_bool());
    let name = options_doc
        .get("name")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let options = IndexOptions::builder().unique(unique).name(name).build();
    let model = IndexModel::builder()
        .keys(keys)
        .options(Some(options))
        .build();
    match collection.create_index(model).await {
        Ok(result) => {
            let mut out = serde_json::Map::new();
            out.insert(
                String::from("name"),
                serde_json::Value::from(result.index_name),
            );
            Ok(serde_json::Value::Object(out))
        }
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_drop_index(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let name = match args.first().and_then(|value| value.as_str()) {
        Some(value) => value.to_string(),
        None => return Err(String::from("dropIndex expects an index name")),
    };
    match collection.drop_index(name).await {
        Ok(_) => Ok(ok_result()),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_rename(
    client: &Client,
    db_name: &str,
    collection_name: &str,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let target = match args.first().and_then(|value| value.as_str()) {
        Some(value) => value,
        None => return Err(String::from("renameCollection expects a target name")),
    };
    let mut command = bson::Document::new();
    command.insert(
        "renameCollection",
        format!("{}.{}", db_name, collection_name),
    );
    command.insert("to", format!("{}.{}", db_name, target));
    // renameCollection must run against the admin database.
    match client.database("admin").run_command(command).await {
        Ok(doc) => Ok(bson_doc_to_json(doc)),
        Err(e) => Err(e.to_string()),
    }
}

/// A minimal `{ ok: 1 }` acknowledgement for void operations.
fn ok_result() -> serde_json::Value {
    let mut out = serde_json::Map::new();
    out.insert(String::from("ok"), serde_json::Value::from(1));
    serde_json::Value::Object(out)
}
