use crate::error::AppError;
use mongodb::bson;
use serde::Serialize;
use tauri::State;

use crate::resolve;
use crate::resolve_mongo;
use crate::try_mongo;

use super::{
    AppContext
};

// A database user, normalized from the `usersInfo` result.
#[derive(Serialize)]
pub struct UserInfo {
    pub user: String,
    pub db: String,
    pub roles: Vec<String>,   // each as "role@db"
}

// Extract the role list from a user document's `roles` array into "role@db" strings.
fn extract_roles(user: &bson::Document) -> Vec<String> {
    let mut roles: Vec<String> = Vec::new();
    if let Some(bson::Bson::Array(entries)) = user.get("roles") {
        for entry in entries {
            if let bson::Bson::Document(role_doc) = entry {
                let role = match role_doc.get("role") {
                    Some(bson::Bson::String(text)) => text.clone(),
                    _ => continue,
                };
                let db = match role_doc.get("db") {
                    Some(bson::Bson::String(text)) => text.clone(),
                    _ => String::new(),
                };
                roles.push(format!("{role}@{db}"));
            }
        }
    }
    roles
}

/// List the users defined on a database (via `usersInfo`).
#[tauri::command]
pub async fn list_users(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
) -> Result<Vec<UserInfo>, AppError> {
    let client = resolve!(ctx.client(&id).await);
    let result = resolve_mongo!(client.database(&database).run_command(bson::doc! { "usersInfo": 1 }).await);
    let mut users: Vec<UserInfo> = Vec::new();
    if let Some(bson::Bson::Array(entries)) = result.get("users") {
        for entry in entries {
            if let bson::Bson::Document(user_doc) = entry {
                let user = match user_doc.get("user") {
                    Some(bson::Bson::String(text)) => text.clone(),
                    _ => continue,
                };
                let db = match user_doc.get("db") {
                    Some(bson::Bson::String(text)) => text.clone(),
                    _ => database.clone(),
                };
                users.push(UserInfo {
                    user: user,
                    db: db,
                    roles: extract_roles(user_doc),
                });
            }
        }
    }
    Ok(users)
}

/// Create a database user with a password and roles. Each role is "role" (granted on
/// `database`) or "role@otherdb".
#[tauri::command]
pub async fn create_user(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    username: String,
    password: String,
    roles: Vec<String>,
) -> Result<(), AppError> {
    let client = resolve!(ctx.client_for_write(&id).await);
    let mut role_docs: Vec<bson::Bson> = Vec::new();
    for role in roles.iter() {
        let trimmed = role.trim();
        if trimmed.is_empty() {
            continue;
        }
        let role_doc = match trimmed.split_once('@') {
            Some((name, db)) => bson::doc! { "role": name, "db": db },
            None => bson::doc! { "role": trimmed, "db": &database },
        };
        role_docs.push(bson::Bson::Document(role_doc));
    }
    let command = bson::doc! {
        "createUser": &username,
        "pwd": &password,
        "roles": role_docs,
    };
    try_mongo!(client.database(&database).run_command(command).await)
}

// Rebuild the `roles` array (as `[{ role, db }]`) from a source user document, preserving
// each role's originating database so the grant means the same on the target server.
fn role_docs_from_user(user: &bson::Document) -> Vec<bson::Bson> {
    let mut role_docs: Vec<bson::Bson> = Vec::new();
    if let Some(bson::Bson::Array(entries)) = user.get("roles") {
        for entry in entries {
            if let bson::Bson::Document(role_doc) = entry {
                let role = match role_doc.get("role") {
                    Some(bson::Bson::String(text)) => text.clone(),
                    _ => continue,
                };
                let db = match role_doc.get("db") {
                    Some(bson::Bson::String(text)) => text.clone(),
                    _ => continue,
                };
                role_docs.push(bson::Bson::Document(bson::doc! { "role": role, "db": db }));
            }
        }
    }
    role_docs
}

// The outcome of copying one user to the target server.
#[derive(Serialize)]
pub struct CopiedUser {
    pub user: String,
    pub roles: Vec<String>,          // "role@db" for display
    pub status: String,              // "created" | "error"
    pub temp_password: Option<String>, // the generated password (only when created)
    pub message: Option<String>,     // error detail (only on failure)
}

/// Copy the users defined on a source database to another connection/database, recreating
/// each with the SAME roles. MongoDB can't export a user's password hash in a form
/// `createUser` accepts, so each copied user is given a generated temporary password
/// (returned here) that must be reset. Users are copied independently: one failure (e.g. a
/// user that already exists, or a custom role missing on the target) is reported per-user
/// and does not stop the rest.
#[tauri::command]
pub async fn copy_users_to_connection(
    ctx: State<'_, AppContext>,
    source_id: String,
    source_database: String,
    target_id: String,
    target_database: String,
) -> Result<Vec<CopiedUser>, AppError> {
    let source_client = resolve!(ctx.client(&source_id).await);
    let result = match source_client
        .database(&source_database)
        .run_command(bson::doc! { "usersInfo": 1 })
        .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };

    let target_client = resolve!(ctx.client_for_write(&target_id).await);
    let target_db = target_client.database(&target_database);

    let mut copied: Vec<CopiedUser> = Vec::new();
    if let Some(bson::Bson::Array(entries)) = result.get("users") {
        for entry in entries {
            let user_doc = match entry {
                bson::Bson::Document(doc) => doc,
                _ => continue,
            };
            let username = match user_doc.get("user") {
                Some(bson::Bson::String(text)) => text.clone(),
                _ => continue,
            };
            let roles = extract_roles(user_doc);
            let role_docs = role_docs_from_user(user_doc);
            let temp_password = format!("Tmp-{}", uuid::Uuid::new_v4());
            let command = bson::doc! {
                "createUser": &username,
                "pwd": &temp_password,
                "roles": role_docs,
            };
            match target_db.run_command(command).await {
                Ok(_) => copied.push(CopiedUser {
                    user: username,
                    roles: roles,
                    status: String::from("created"),
                    temp_password: Some(temp_password),
                    message: None,
                }),
                Err(e) => copied.push(CopiedUser {
                    user: username,
                    roles: roles,
                    status: String::from("error"),
                    temp_password: None,
                    message: Some(format!("{e}")),
                }),
            }
        }
    }
    Ok(copied)
}

/// Drop a database user by name.
#[tauri::command]
pub async fn drop_user(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    username: String,
) -> Result<(), AppError> {
    let client = resolve!(ctx.client_for_write(&id).await);
    try_mongo!(client.database(&database).run_command(bson::doc! { "dropUser": &username }).await)
}

/// List the role names defined on a database (via `rolesInfo`; built-in roles excluded).
#[tauri::command]
pub async fn list_roles(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
) -> Result<Vec<String>, AppError> {
    let client = resolve!(ctx.client(&id).await);
    let command = bson::doc! { "rolesInfo": 1, "showBuiltinRoles": false };
    let result = resolve_mongo!(client.database(&database).run_command(command).await);
    let mut roles: Vec<String> = Vec::new();
    if let Some(bson::Bson::Array(entries)) = result.get("roles") {
        for entry in entries {
            if let bson::Bson::Document(role_doc) = entry {
                if let Some(bson::Bson::String(name)) = role_doc.get("role") {
                    roles.push(name.clone());
                }
            }
        }
    }
    Ok(roles)
}
