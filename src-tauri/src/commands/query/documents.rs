use crate::collection_history::CollectionHistoryStore;
use crate::error::AppError;
use mongodb::bson;
use tauri::State;

use super::{parse_ejson_document, parse_json_documents, record_history, AppContext};

#[tauri::command]
pub async fn insert_document(
    ctx: State<'_, AppContext>,
    history: State<'_, CollectionHistoryStore>,
    id: String,
    database: String,
    collection: String,
    document: String,
) -> Result<String, AppError> {
    let col = ctx.collection_for_write(&id, &database, &collection).await?;
    let doc = parse_ejson_document(&document)?;
    let result = col.insert_one(doc).await?;
    // Record the insert so it can be undone (restore = delete this document).
    record_history(&history, &id, &database, &collection, "insert", &result.inserted_id, None);
    Ok(result.inserted_id.to_string())
}

// Insert one or many documents from a single Extended-JSON string — the Edit menu's
// "Paste Document(s)". The text may be a single object or a JSON array of objects;
// `parse_json_documents` validates it and surfaces a human-readable error on bad
// input (so a failed paste is a toast, not a crash). Returns the number inserted.
#[tauri::command]
pub async fn insert_documents(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
    documents: String,
) -> Result<usize, AppError> {
    let docs = match parse_json_documents(&documents) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    if docs.is_empty() {
        return Err(AppError::Bson(
            "Clipboard has no document(s) to paste".to_string(),
        ));
    }
    let col = ctx.collection_for_write(&id, &database, &collection).await?;
    match col.insert_many(docs).await {
        Ok(result) => Ok(result.inserted_ids.len()),
        Err(e) => Err(AppError::Mongo(e)),
    }
}

#[tauri::command]
pub async fn replace_document(
    ctx: State<'_, AppContext>,
    history: State<'_, CollectionHistoryStore>,
    id: String,
    database: String,
    collection: String,
    id_filter: String,
    document: String,
) -> Result<(), AppError> {
    let col = ctx.collection_for_write(&id, &database, &collection).await?;
    let filter_doc = parse_ejson_document(&id_filter)?;
    let mut replacement = parse_ejson_document(&document)?;
    // Capture the pre-image before replacing, so the edit can be undone.
    let before = col.find_one(filter_doc.clone()).await?;
    // MongoDB errors if the replacement contains an _id that differs from the filter.
    // Remove it unconditionally — the existing _id is preserved by replace_one.
    replacement.remove("_id");
    match col.replace_one(filter_doc, replacement).await {
        Ok(_) => {}
        Err(e) => return Err(AppError::Mongo(e)),
    }
    if let Some(before_doc) = before {
        let doc_id = match before_doc.get("_id") {
            Some(val) => val.clone(),
            None => bson::Bson::Null,
        };
        record_history(&history, &id, &database, &collection, "update", &doc_id, Some(&before_doc));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_document(
    ctx: State<'_, AppContext>,
    history: State<'_, CollectionHistoryStore>,
    id: String,
    database: String,
    collection: String,
    id_filter: String,
) -> Result<(), AppError> {
    let col = ctx.collection_for_write(&id, &database, &collection).await?;
    let filter_doc = parse_ejson_document(&id_filter)?;
    // Capture the pre-image before deleting, so the delete can be undone.
    let before = col.find_one(filter_doc.clone()).await?;
    match col.delete_one(filter_doc).await {
        Ok(_) => {}
        Err(e) => return Err(AppError::Mongo(e)),
    }
    if let Some(before_doc) = before {
        let doc_id = match before_doc.get("_id") {
            Some(val) => val.clone(),
            None => bson::Bson::Null,
        };
        record_history(&history, &id, &database, &collection, "delete", &doc_id, Some(&before_doc));
    }
    Ok(())
}

/// Whether an update document is in operator form (every top-level key starts with
/// `$`, e.g. `{ "$set": … }`). update_many rejects replacement-style documents, so we
/// check up front to return a clear message instead of a raw driver error. An empty
/// update is not valid operator form.
fn is_operator_update(update: &bson::Document) -> bool {
    !update.is_empty() && update.keys().all(|key| key.starts_with('$'))
}

/// Update documents matching `filter` with the given `update` document (which must
/// contain update operators such as `$set` / `$unset`). Backs the Collection → Update
/// Dialog. When `multi` is true every match is updated (update_many); when false only
/// the first match is (update_one). `upsert` inserts a new document when nothing
/// matches. Returns the number of documents affected — modified plus one for an
/// upsert-insert so the caller never reports 0 after creating a document.
#[tauri::command]
pub async fn update_many(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
    filter: String,
    update: String,
    upsert: bool,
    multi: bool,
) -> Result<i64, AppError> {
    let col = ctx.collection_for_write(&id, &database, &collection).await?;
    let filter_doc = parse_ejson_document(&filter)?;
    let update_doc = parse_ejson_document(&update)?;
    // Guard against a replacement-style document reaching the update, which the
    // driver rejects: every top-level key of an update must be an operator ($set…).
    if !is_operator_update(&update_doc) {
        return Err(AppError::Bson(
            "Update must use operators, e.g. { \"$set\": { \"field\": value } }".to_string(),
        ));
    }
    let result = if multi {
        match col.update_many(filter_doc, update_doc).upsert(upsert).await {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        }
    } else {
        match col.update_one(filter_doc, update_doc).upsert(upsert).await {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        }
    };
    let upserted = match result.upserted_id {
        Some(_) => 1,
        None => 0,
    };
    Ok(result.modified_count as i64 + upserted)
}

/// Delete every document matching `filter`. Backs the Collection → Delete Dialog.
/// The caller is responsible for confirming the operation. Returns the number of
/// documents deleted.
#[tauri::command]
pub async fn delete_many(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
    filter: String,
) -> Result<i64, AppError> {
    let col = ctx.collection_for_write(&id, &database, &collection).await?;
    let filter_doc = parse_ejson_document(&filter)?;
    let result = col.delete_many(filter_doc).await?;
    Ok(result.deleted_count as i64)
}

/// Delete every document in the collection while keeping the (empty) collection and
/// its indexes — the "Clear Collection" action, distinct from dropping it. The caller
/// is responsible for confirming. Returns the number of documents removed.
#[tauri::command]
pub async fn clear_collection(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
) -> Result<i64, AppError> {
    let col = ctx.collection_for_write(&id, &database, &collection).await?;
    // An empty filter matches every document; the collection itself is untouched.
    let result = col.delete_many(bson::doc! {}).await?;
    Ok(result.deleted_count as i64)
}

#[cfg(test)]
#[path = "documents.test.rs"]
mod tests;
