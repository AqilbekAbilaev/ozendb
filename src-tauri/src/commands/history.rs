use crate::collection_history::{CollectionHistoryStore, HistoryEntry};
use crate::error::AppError;
use crate::try_mongo;
use mongodb::bson;
use tauri::State;

use super::AppContext;

/// Every recorded change for one collection, newest-first — backs the Collection History
/// panel (Studio-3T's undo-your-edits/deletes safety net).
#[tauri::command]
pub fn list_collection_history(
    history: State<'_, CollectionHistoryStore>,
    id: String,
    database: String,
    collection: String,
) -> Vec<HistoryEntry> {
    history.list_for(&id, &database, &collection)
}

/// Forget all history for one collection.
#[tauri::command]
pub fn clear_collection_history(
    history: State<'_, CollectionHistoryStore>,
    id: String,
    database: String,
    collection: String,
) -> Result<(), AppError> {
    history.clear_for(&id, &database, &collection)
}

// Decode a stored Extended-JSON string (a pre-image or an _id) back into BSON.
fn decode_bson(text: &str) -> Result<bson::Bson, AppError> {
    match serde_json::from_str::<bson::Bson>(text) {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Bson(format!("Unreadable history entry: {e}"))),
    }
}

/// Reverse a recorded change: re-insert a deleted document, put back the pre-image of an
/// edit, or remove an inserted document. The entry stays in history after restoring.
#[tauri::command]
pub async fn restore_history(
    ctx: State<'_, AppContext>,
    history: State<'_, CollectionHistoryStore>,
    entry_id: String,
) -> Result<(), AppError> {
    let entry = match history.get(&entry_id) {
        Some(val) => val,
        None => return Err(AppError::Validation("That history entry no longer exists.".to_string())),
    };

    let col = match ctx
        .collection_for_write(&entry.conn_id, &entry.database, &entry.collection)
        .await
    {
        Ok(val) => val,
        Err(e) => return Err(e),
    };

    let doc_id = match decode_bson(&entry.doc_id) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let filter = bson::doc! { "_id": doc_id };

    if entry.op == "insert" {
        // Undo an insert by deleting the document again.
        match col.delete_one(filter).await {
            Ok(_) => return Ok(()),
            Err(e) => return Err(AppError::Mongo(e)),
        }
    }

    // update / delete: put the pre-image back. Upsert so a since-deleted document returns,
    // and the filter's _id is preserved on insert.
    let before_text = match entry.before {
        Some(val) => val,
        None => {
            return Err(AppError::Validation(
                "This change has no saved pre-image to restore.".to_string(),
            ))
        }
    };
    let before_bson = match decode_bson(&before_text) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let mut before_doc = match before_bson {
        bson::Bson::Document(doc) => doc,
        _ => return Err(AppError::Bson("History pre-image is not a document.".to_string())),
    };
    // _id rides in the filter; a replacement carrying a differing _id is rejected.
    before_doc.remove("_id");

    try_mongo!(col.replace_one(filter, before_doc).upsert(true).await)
}
