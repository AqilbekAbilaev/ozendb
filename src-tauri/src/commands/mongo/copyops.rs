use crate::error::AppError;
use mongodb::bson;
use tauri::State;


use super::{
    next_document, AppContext, IMPORT_BATCH_SIZE
};

/// Copy a collection to another collection (optionally in another database) on the
/// SAME connection, via an aggregation `$out`. The target collection is replaced if
/// it already exists. Cross-connection copies are not supported here (the frontend
/// guards against them).
#[tauri::command]
pub async fn copy_collection(
    ctx: State<'_, AppContext>,
    id: String,
    source_database: String,
    source_collection: String,
    target_database: String,
    target_collection: String,
) -> Result<(), AppError> {
    // Copy writes into the target collection on this same connection, so gate on
    // the connection being writable (the `$out` below is the write).
    let src = ctx.collection_for_write(&id, &source_database, &source_collection).await?;
    let pipeline = vec![
        bson::doc! { "$match": {} },
        bson::doc! { "$out": { "db": &target_database, "coll": &target_collection } },
    ];
    // $out runs as the aggregation is driven, so advance the cursor to completion.
    let mut cursor = match src.aggregate(pipeline).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
    loop {
        match cursor.advance().await {
            Ok(true) => continue,
            Ok(false) => break,
            Err(e) => return Err(AppError::Mongo(e)),
        }
    }
    Ok(())
}

/// Copy a collection to another connection (a different server). `$out` is server-local,
/// so this streams documents from the source and batch-inserts them into the target,
/// replacing the target collection first (matching the same-server copy's semantics).
/// Indexes are not copied (neither does `$out`). Returns the number of documents copied.
#[tauri::command]
pub async fn copy_collection_to_connection(
    ctx: State<'_, AppContext>,
    source_id: String,
    source_database: String,
    source_collection: String,
    target_id: String,
    target_database: String,
    target_collection: String,
) -> Result<u64, AppError> {
    // Refuse copying a collection onto itself — we drop the target first, which would
    // wipe the source before anything is read.
    if source_id == target_id
        && source_database == target_database
        && source_collection == target_collection
    {
        return Err(AppError::Validation(
            "Source and target are the same collection.".to_string(),
        ));
    }

    let src = match ctx
        .collection(&source_id, &source_database, &source_collection)
        .await
    {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let dst = match ctx
        .collection_for_write(&target_id, &target_database, &target_collection)
        .await
    {
        Ok(val) => val,
        Err(e) => return Err(e),
    };

    // Replace semantics: drop the target so a re-copy doesn't collide on `_id`. Dropping a
    // non-existent collection is a no-op in MongoDB.
    let _ = dst.drop().await?;

    // Stream the source and insert in bounded batches so peak memory stays O(batch).
    let mut cursor = match src.find(bson::doc! {}).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
    let mut batch: Vec<bson::Document> = Vec::with_capacity(IMPORT_BATCH_SIZE);
    let mut count: u64 = 0;
    loop {
        let next = next_document(&mut cursor).await?;
        match next {
            Some(doc) => {
                batch.push(doc);
                if batch.len() >= IMPORT_BATCH_SIZE {
                    match dst.insert_many(&batch).await {
                        Ok(_) => {}
                        Err(e) => return Err(AppError::Mongo(e)),
                    }
                    count += batch.len() as u64;
                    batch.clear();
                }
            }
            None => break,
        }
    }
    if !batch.is_empty() {
        match dst.insert_many(&batch).await {
            Ok(_) => {}
            Err(e) => return Err(AppError::Mongo(e)),
        }
        count += batch.len() as u64;
    }

    Ok(count)
}
