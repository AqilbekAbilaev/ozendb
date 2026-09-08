use mongodb::bson;
use mongodb::Collection;

use super::{arg_doc, bson_doc_to_json, to_document};
use super::super::{DEFAULT_FIND_LIMIT, MAX_DOCS, MAX_QUERY_TIME};

pub(super) async fn exec_find(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let filter = arg_doc(args, 0)?;
    let mut query = collection.find(filter);
    let projection = arg_doc(args, 1)?;
    if !projection.is_empty() {
        query = query.projection(projection);
    }
    let sort = arg_doc(args, 2)?;
    if !sort.is_empty() {
        query = query.sort(sort);
    }
    if let Some(skip) = args.get(3).and_then(|value| value.as_f64()) {
        if skip > 0.0 {
            query = query.skip(skip as u64);
        }
    }
    let requested = args
        .get(4)
        .and_then(|value| value.as_f64())
        .map(|value| value as i64)
        .unwrap_or(0);
    let limit = if requested <= 0 {
        DEFAULT_FIND_LIMIT
    } else {
        requested.min(MAX_DOCS as i64)
    };
    let mut cursor = query.limit(limit).max_time(MAX_QUERY_TIME).await
        .map_err(|e| e.to_string())?;
    let mut docs = Vec::new();
    while cursor.advance().await.map_err(|e| e.to_string())? {
        let doc: bson::Document = cursor.deserialize_current().map_err(|e| e.to_string())?;
        docs.push(bson_doc_to_json(doc));
    }
    Ok(serde_json::Value::Array(docs))
}

pub(super) async fn exec_find_one(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let mut query = collection.find_one(arg_doc(args, 0)?);
    if args.len() > 1 {
        let projection = arg_doc(args, 1)?;
        if !projection.is_empty() {
            query = query.projection(projection);
        }
    }
    match query.await.map_err(|e| e.to_string())? {
        Some(doc) => Ok(bson_doc_to_json(doc)),
        None => Ok(serde_json::Value::Null),
    }
}

pub(super) async fn exec_count(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let count = collection.count_documents(arg_doc(args, 0)?)
        .max_time(MAX_QUERY_TIME)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::Value::from(count))
}

pub(super) async fn exec_aggregate(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let values = args.first().and_then(|value| value.as_array())
        .ok_or_else(|| String::from("aggregate expects a pipeline array"))?;
    let stages = values.iter().map(to_document).collect::<Result<Vec<_>, _>>()?;
    let mut cursor = collection.aggregate(stages).max_time(MAX_QUERY_TIME).await
        .map_err(|e| e.to_string())?;
    let mut docs = Vec::new();
    while docs.len() < MAX_DOCS && cursor.advance().await.map_err(|e| e.to_string())? {
        let doc: bson::Document = cursor.deserialize_current().map_err(|e| e.to_string())?;
        docs.push(bson_doc_to_json(doc));
    }
    Ok(serde_json::Value::Array(docs))
}

pub(super) async fn exec_estimated_count(
    collection: &Collection<bson::Document>,
) -> Result<serde_json::Value, String> {
    let count = collection.estimated_document_count().await.map_err(|e| e.to_string())?;
    Ok(serde_json::Value::from(count))
}

pub(super) async fn exec_distinct(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let field = args.first().and_then(|value| value.as_str())
        .ok_or_else(|| String::from("distinct expects a field name"))?;
    let values = collection.distinct(field, arg_doc(args, 1)?)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::Value::Array(
        values.into_iter().map(serde_json::Value::from).collect(),
    ))
}
