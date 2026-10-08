use crate::error::AppError;
use crate::operations::OperationsRegistry;
use mongodb::bson;
use tauri::State;

use super::{data_op_meta, AppContext};
use crate::commands::portmap::{apply_field_map, FieldMap};

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
        super::super::stream_export(
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
    super::tracked(&ops, Some(meta), run).await
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
        super::super::stream_import(
            &col,
            &path,
            &format,
            None,
            super::super::CsvOptions::default(),
        )
        .await
    };
    super::tracked(&ops, Some(meta), run).await
}

#[tauri::command]
pub async fn import_collection_mapped(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
    path: String,
    format: String,
    mapping: Vec<FieldMap>,
    csv: Option<super::super::CsvOptionsInput>,
) -> Result<usize, AppError> {
    let client = ctx.client_for_write(&id).await?;
    let col = client
        .database(&database)
        .collection::<bson::Document>(&collection);
    let mapping = if mapping.is_empty() { None } else { Some(mapping) };
    let csv = match csv {
        Some(input) => input.to_options(),
        None => super::super::CsvOptions::default(),
    };
    super::super::stream_import(&col, &path, &format, mapping, csv).await
}

pub(super) fn watermark_to_string(id: &bson::Bson) -> String {
    id.clone().into_canonical_extjson().to_string()
}

pub(super) fn watermark_from_string(text: &str) -> Option<bson::Bson> {
    serde_json::from_str::<bson::Bson>(text).ok()
}

pub(super) fn incremental_filter(
    previous: Option<&bson::Bson>,
    boundary: &bson::Bson,
) -> bson::Document {
    match previous {
        Some(previous) => bson::doc! {
            "_id": { "$gt": previous.clone(), "$lte": boundary.clone() }
        },
        None => bson::doc! {
            "_id": { "$lte": boundary.clone() }
        },
    }
}

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
    filter: Option<String>,
) -> Result<usize, AppError> {
    let client = ctx.client(&id).await?;
    let col = client
        .database(&database)
        .collection::<bson::Document>(&collection);

    let use_incremental = incremental.unwrap_or(false);
    let watermark_key = format!("{}/{}/{}", id, database, collection);
    let mut filter = match filter.as_deref().map(str::trim) {
        Some("") | Some("{}") | None => bson::doc! {},
        Some(text) => super::parse_ejson_document(text)?,
    };
    let mut new_watermark = None;

    if use_incremental {
        let boundary = match max_id(&col).await? {
            Some(value) => value,
            None => return Ok(0),
        };
        let previous = watermarks
            .get(&watermark_key)
            .as_deref()
            .and_then(watermark_from_string);
        let window = incremental_filter(previous.as_ref(), &boundary);
        filter = if filter.is_empty() {
            window
        } else {
            bson::doc! { "$and": [filter, window] }
        };
        new_watermark = Some(boundary);
    }

    let count = super::super::stream_export(
        &col,
        filter,
        None,
        None,
        &path,
        &format,
        move |doc: &mut bson::Document| -> Result<(), AppError> {
            if !fields.is_empty() {
                *doc = apply_field_map(doc, &fields);
            }
            Ok(())
        },
    )
    .await?;

    if let Some(boundary) = new_watermark {
        watermarks.set(&watermark_key, &watermark_to_string(&boundary))?;
    }

    Ok(count)
}

async fn max_id(
    col: &mongodb::Collection<bson::Document>,
) -> Result<Option<bson::Bson>, AppError> {
    let found = col
        .find_one(bson::doc! {})
        .sort(bson::doc! { "_id": -1 })
        .await?;
    Ok(found.and_then(|doc| doc.get("_id").cloned()))
}
