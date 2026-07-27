use crate::error::AppError;
use mongodb::bson;
use serde::Serialize;
use tauri::State;
use crate::resolve;

use super::{
    AppContext
};

// A single index's on-disk size, pulled from collStats.indexSizes.
#[derive(Serialize)]
pub struct IndexSize {
    pub name: String,
    pub size: i64,
}

// The headline numbers from `collStats`, normalized into typed fields so the UI
// doesn't have to dig through the raw document. The full raw result is kept too,
// for the "show raw" view and forward-compatibility with fields we don't surface.
#[derive(Serialize)]
pub struct CollectionStats {
    pub ns: Option<String>,
    pub count: Option<i64>,
    pub size: Option<i64>,
    pub avg_obj_size: Option<i64>,
    pub storage_size: Option<i64>,
    pub total_index_size: Option<i64>,
    pub nindexes: Option<i64>,
    pub capped: bool,
    pub indexes: Vec<IndexSize>,
    pub raw: serde_json::Value,
}

// collStats mixes Int32 / Int64 / Double for its numeric fields depending on the
// server and value magnitude, so read any of them as i64.

// Pure extraction from a raw collStats document into the typed summary. Kept free
// of I/O so it can be unit-tested with a hand-built document.
pub(crate) fn extract_stats(doc: &bson::Document) -> CollectionStats {
    let mut indexes: Vec<IndexSize> = Vec::new();
    if let Some(bson::Bson::Document(sizes)) = doc.get("indexSizes") {
        for (name, value) in sizes {
            if let Some(size) = crate::commands::bson_as_i64(Some(value)) {
                indexes.push(IndexSize { name: name.clone(), size: size });
            }
        }
    }
    // Largest index first — the useful ordering when hunting bloat.
    indexes.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));

    let capped = match doc.get("capped") {
        Some(bson::Bson::Boolean(value)) => *value,
        _ => false,
    };
    let ns = match doc.get("ns") {
        Some(bson::Bson::String(value)) => Some(value.clone()),
        _ => None,
    };

    CollectionStats {
        ns: ns,
        count: crate::commands::bson_as_i64(doc.get("count")),
        size: crate::commands::bson_as_i64(doc.get("size")),
        avg_obj_size: crate::commands::bson_as_i64(doc.get("avgObjSize")),
        storage_size: crate::commands::bson_as_i64(doc.get("storageSize")),
        total_index_size: crate::commands::bson_as_i64(doc.get("totalIndexSize")),
        nindexes: crate::commands::bson_as_i64(doc.get("nindexes")),
        capped: capped,
        indexes: indexes,
        raw: serde_json::Value::from(bson::Bson::Document(doc.clone())),
    }
}

/// Collection statistics (`collStats`): document count, data/storage size, average
/// document size, index count and per-index sizes. Studio-3T surfaces the same
/// numbers in its Collection Stats view.
#[tauri::command]
pub async fn collection_stats(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
) -> Result<CollectionStats, AppError> {
    let client = resolve!(ctx.client(&id).await);
    let command = bson::doc! { "collStats": &collection };
    let result = match client.database(&database).run_command(command).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
    Ok(extract_stats(&result))
}

#[cfg(test)]
#[path = "stats.test.rs"]
mod tests;
