use crate::error::AppError;
use mongodb::bson;
use serde::Serialize;
use tauri::State;


use super::{
    next_document, AppContext
};

// A server-side stored function, from a `system.js` document ({ _id, value: Code }).
#[derive(Serialize)]
pub struct StoredFunction {
    pub name: String,
    pub body: String,
}

// Extract the JS source from a `value` field, which is stored as BSON JavaScript.
fn code_to_string(value: Option<&bson::Bson>) -> String {
    match value {
        Some(bson::Bson::JavaScriptCode(code)) => code.clone(),
        Some(bson::Bson::JavaScriptCodeWithScope(cws)) => cws.code.clone(),
        Some(bson::Bson::String(text)) => text.clone(),
        _ => String::new(),
    }
}

/// List the stored functions in a database (its `system.js` documents).
#[tauri::command]
pub async fn list_functions(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
) -> Result<Vec<StoredFunction>, AppError> {
    let coll = ctx.collection(&id, &database, "system.js").await?;
    let mut cursor = match coll.find(bson::doc! {}).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
    let mut functions: Vec<StoredFunction> = Vec::new();
    loop {
        let doc: bson::Document = match next_document(&mut cursor).await {
            Ok(Some(value)) => value,
            Ok(None) => break,
            Err(e) => return Err(e),
        };
        let name = match doc.get("_id") {
            Some(bson::Bson::String(text)) => text.clone(),
            Some(other) => other.to_string(),
            None => continue,
        };
        functions.push(StoredFunction {
            name: name,
            body: code_to_string(doc.get("value")),
        });
    }
    Ok(functions)
}

/// Create or update a stored function: upsert `{ _id: name, value: Code(body) }`.
#[tauri::command]
pub async fn save_function(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    name: String,
    body: String,
) -> Result<(), AppError> {
    let coll = ctx.collection_for_write(&id, &database, "system.js").await?;
    let update = bson::doc! { "$set": { "value": bson::Bson::JavaScriptCode(body) } };
    match coll
        .update_one(bson::doc! { "_id": &name }, update)
        .upsert(true)
        .await
    {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::Mongo(e)),
    }
}

/// Delete a stored function by name.
#[tauri::command]
pub async fn drop_function(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    name: String,
) -> Result<(), AppError> {
    let coll = ctx.collection_for_write(&id, &database, "system.js").await?;
    coll.delete_one(bson::doc! { "_id": &name }).await?;
    Ok(())
}
