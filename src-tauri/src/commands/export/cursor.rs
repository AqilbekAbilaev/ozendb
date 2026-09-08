use crate::error::AppError;
use mongodb::bson;

/// Advance a document cursor by one, returning the next document or `None` at the
/// end. The single place the advance/deserialize dance lives — every command loop
/// that reads documents goes through here.
pub(crate) async fn next_document(
    cursor: &mut mongodb::Cursor<bson::Document>,
) -> Result<Option<bson::Document>, AppError> {
    let has_next = cursor.advance().await?;
    if !has_next {
        return Ok(None);
    }
    match cursor.deserialize_current() {
        Ok(val) => Ok(Some(val)),
        Err(e) => Err(AppError::Mongo(e)),
    }
}

/// Drain a document cursor fully into a `Vec<Document>`. (Shape B.)
pub(crate) async fn collect_documents(
    cursor: &mut mongodb::Cursor<bson::Document>,
) -> Result<Vec<bson::Document>, AppError> {
    let mut docs = Vec::new();
    loop {
        match next_document(cursor).await {
            Ok(Some(doc)) => docs.push(doc),
            Ok(None) => break,
            Err(e) => return Err(e),
        }
    }
    Ok(docs)
}

/// Drain a document cursor fully into JSON values. (Shape A.) Uses bson's own `From`
/// impl (not `serde_json::to_value`) because bson's Serialize targets the wire format.
pub(crate) async fn collect_values(
    cursor: &mut mongodb::Cursor<bson::Document>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let docs = collect_documents(cursor).await?;
    Ok(docs
        .into_iter()
        .map(|doc| serde_json::Value::from(bson::Bson::Document(doc)))
        .collect())
}

/// Drain a document cursor into pre-serialized JSON so Tauri's IPC layer can forward
/// it without constructing an intermediate `Vec<Value>`.
pub(crate) async fn collect_json(
    cursor: &mut mongodb::Cursor<bson::Document>,
) -> Result<Box<serde_json::value::RawValue>, AppError> {
    let mut buf = String::from("[");
    let mut first = true;
    loop {
        match next_document(cursor).await {
            Ok(Some(doc)) => {
                let value = serde_json::Value::from(bson::Bson::Document(doc));
                let text = match serde_json::to_string(&value) {
                    Ok(val) => val,
                    Err(e) => return Err(AppError::Serde(e)),
                };
                if !first {
                    buf.push(',');
                }
                first = false;
                buf.push_str(&text);
            }
            Ok(None) => break,
            Err(e) => return Err(e),
        }
    }
    buf.push(']');
    match serde_json::value::RawValue::from_string(buf) {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Serde(e)),
    }
}
