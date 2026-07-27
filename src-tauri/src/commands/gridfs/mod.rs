use crate::error::AppError;
use futures_util::{AsyncReadExt, AsyncWriteExt};
use mongodb::bson::{self, oid::ObjectId};
use mongodb::options::GridFsBucketOptions;
use serde::Serialize;
use tauri::State;

use crate::resolve;

use super::{
    next_document, parse_ejson_document, AppContext
};

// A GridFS file's display metadata, normalized from its `.files` document.
#[derive(Serialize)]
pub struct GridFsFile {
    pub id: String,
    pub filename: String,
    pub length: i64,
    pub upload_date: Option<String>,
    pub content_type: Option<String>,
}


// Pure extraction of the display fields from a GridFS `.files` document.
pub(crate) fn extract_file(doc: &bson::Document) -> GridFsFile {
    let id = match doc.get("_id") {
        Some(bson::Bson::ObjectId(oid)) => oid.to_hex(),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    let filename = match doc.get("filename") {
        Some(bson::Bson::String(name)) => name.clone(),
        _ => "(unnamed)".to_string(),
    };
    let upload_date = match doc.get("uploadDate") {
        Some(bson::Bson::DateTime(dt)) => dt.try_to_rfc3339_string().ok(),
        _ => None,
    };
    let content_type = match doc.get("contentType") {
        Some(bson::Bson::String(ct)) => Some(ct.clone()),
        _ => None,
    };
    GridFsFile {
        id: id,
        filename: filename,
        length: crate::commands::bson_as_i64(doc.get("length")).unwrap_or(0),
        upload_date: upload_date,
        content_type: content_type,
    }
}

// Derive the GridFS bucket names from a database's collection list: every bucket
// `b` has a `b.files` collection. `.chunks` collections are ignored. Pure, so it
// is unit-tested directly.
pub(crate) fn extract_buckets(collection_names: &[String]) -> Vec<String> {
    let mut buckets: Vec<String> = Vec::new();
    for name in collection_names {
        if let Some(stripped) = name.strip_suffix(".files") {
            if !stripped.is_empty() && !buckets.iter().any(|b| b == stripped) {
                buckets.push(stripped.to_string());
            }
        }
    }
    buckets.sort();
    buckets
}

// Parse a file id (hex ObjectId string) into a BSON value for the GridFS API.
fn parse_file_id(file_id: &str) -> Result<bson::Bson, AppError> {
    match ObjectId::parse_str(file_id) {
        Ok(oid) => Ok(bson::Bson::ObjectId(oid)),
        Err(_) => Err(AppError::Bson(format!("Invalid file id: {file_id}"))),
    }
}

/// List the GridFS buckets in a database (derived from its `*.files` collections).
#[tauri::command]
pub async fn list_gridfs_buckets(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
) -> Result<Vec<String>, AppError> {
    let client = resolve!(ctx.client(&id).await);
    let names = match client.database(&database).list_collection_names().await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
    Ok(extract_buckets(&names))
}

/// List the files in a GridFS bucket (reads the bucket's `.files` collection).
#[tauri::command]
pub async fn list_gridfs_files(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    bucket: String,
) -> Result<Vec<GridFsFile>, AppError> {
    let files = resolve!(ctx.collection(&id, &database, &format!("{bucket}.files")).await);
    let mut cursor = match files.find(bson::doc! {}).sort(bson::doc! { "filename": 1 }).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
    let mut out: Vec<GridFsFile> = Vec::new();
    loop {
        let doc: bson::Document = match next_document(&mut cursor).await {
            Ok(Some(value)) => value,
            Ok(None) => break,
            Err(e) => return Err(e),
        };
        out.push(extract_file(&doc));
    }
    Ok(out)
}

/// Upload a local file into a GridFS bucket. Returns the new file's id (hex).
#[tauri::command]
pub async fn gridfs_upload(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    bucket: String,
    path: String,
) -> Result<String, AppError> {
    let client = resolve!(ctx.client_for_write(&id).await);
    let bytes = match std::fs::read(&path) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Io(e)),
    };
    let filename = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let options = GridFsBucketOptions::builder().bucket_name(bucket).build();
    let gridfs = client.database(&database).gridfs_bucket(Some(options));
    let mut stream = match gridfs.open_upload_stream(&filename).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
    match stream.write_all(&bytes).await {
        Ok(_) => {}
        Err(e) => return Err(AppError::Io(e)),
    }
    match stream.close().await {
        Ok(_) => {}
        Err(e) => return Err(AppError::Io(e)),
    }
    let file_id = stream.id().clone();
    match file_id {
        bson::Bson::ObjectId(oid) => Ok(oid.to_hex()),
        other => Ok(other.to_string()),
    }
}

/// Download a GridFS file (by id) to a local path.
#[tauri::command]
pub async fn gridfs_download(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    bucket: String,
    file_id: String,
    dest: String,
) -> Result<(), AppError> {
    let client = resolve!(ctx.client(&id).await);
    let id_bson = match parse_file_id(&file_id) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let options = GridFsBucketOptions::builder().bucket_name(bucket).build();
    let gridfs = client.database(&database).gridfs_bucket(Some(options));
    let mut stream = match gridfs.open_download_stream(id_bson).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
    let mut buf: Vec<u8> = Vec::new();
    match stream.read_to_end(&mut buf).await {
        Ok(_) => {}
        Err(e) => return Err(AppError::Io(e)),
    }
    match std::fs::write(&dest, buf) {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Delete a GridFS file by id.
#[tauri::command]
pub async fn gridfs_delete(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    bucket: String,
    file_id: String,
) -> Result<(), AppError> {
    let client = resolve!(ctx.client_for_write(&id).await);
    let id_bson = match parse_file_id(&file_id) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let options = GridFsBucketOptions::builder().bucket_name(bucket).build();
    let gridfs = client.database(&database).gridfs_bucket(Some(options));
    match gridfs.delete(id_bson).await {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::Mongo(e)),
    }
}

/// Rename a GridFS file by updating the `filename` field on its `.files` document.
#[tauri::command]
pub async fn gridfs_rename(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    bucket: String,
    file_id: String,
    new_name: String,
) -> Result<(), AppError> {
    let id_bson = match parse_file_id(&file_id) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let files = resolve!(ctx.collection_for_write(&id, &database, &format!("{bucket}.files")).await);
    match files
        .update_one(bson::doc! { "_id": id_bson }, bson::doc! { "$set": { "filename": new_name } })
        .await
    {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::Mongo(e)),
    }
}

/// Set a GridFS file's `metadata` document (from an Extended JSON string) on its
/// `.files` document. An empty string clears the metadata.
#[tauri::command]
pub async fn gridfs_set_metadata(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    bucket: String,
    file_id: String,
    metadata: String,
) -> Result<(), AppError> {
    let metadata_doc = if metadata.trim().is_empty() || metadata.trim() == "{}" {
        bson::Document::new()
    } else {
        match parse_ejson_document(&metadata) {
            Ok(val) => val,
            Err(e) => return Err(e),
        }
    };
    let id_bson = match parse_file_id(&file_id) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let files = resolve!(ctx.collection_for_write(&id, &database, &format!("{bucket}.files")).await);
    match files
        .update_one(bson::doc! { "_id": id_bson }, bson::doc! { "$set": { "metadata": metadata_doc } })
        .await
    {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::Mongo(e)),
    }
}

/// Drop a GridFS bucket by dropping its `.files` and `.chunks` collections.
#[tauri::command]
pub async fn gridfs_drop_bucket(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    bucket: String,
) -> Result<(), AppError> {
    let client = resolve!(ctx.client_for_write(&id).await);
    let db = client.database(&database);
    for suffix in ["files", "chunks"] {
        let coll = db.collection::<bson::Document>(&format!("{bucket}.{suffix}"));
        match coll.drop().await {
            Ok(_) => {}
            Err(e) => return Err(AppError::Mongo(e)),
        }
    }
    Ok(())
}

/// Copy a GridFS bucket to a new bucket name by copying its `.files` and `.chunks`
/// collections with an aggregation `$out`. The target bucket is replaced if present.
#[tauri::command]
pub async fn gridfs_copy_bucket(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    bucket: String,
    new_bucket: String,
) -> Result<(), AppError> {
    let client = resolve!(ctx.client_for_write(&id).await);
    let db = client.database(&database);
    for suffix in ["files", "chunks"] {
        let src = db.collection::<bson::Document>(&format!("{bucket}.{suffix}"));
        let pipeline = vec![
            bson::doc! { "$match": {} },
            bson::doc! { "$out": format!("{new_bucket}.{suffix}") },
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
    }
    Ok(())
}

#[cfg(test)]
#[path = "gridfs.test.rs"]
mod tests;
