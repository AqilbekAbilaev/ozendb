//! The sidebar's stored programs: each database's procedures, functions, triggers and
//! events, read from information_schema, which lists only what the login may see.
use crate::error::AppError;
use serde::Serialize;
use sqlx::MySqlPool;
use tauri::State;

use super::AppContext;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlRoutine {
    pub name: String,
    /// "procedure" or "function": a procedure and a function may share a name.
    pub kind: String,
    /// What a function returns, as declared (`varchar(10)`); None for a procedure.
    pub returns: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlTrigger {
    pub name: String,
    pub table: String,
    /// "BEFORE" or "AFTER".
    pub timing: String,
    /// "INSERT", "UPDATE" or "DELETE".
    pub event: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlEvent {
    pub name: String,
    /// When it runs, in MySQL's own words: `EVERY 1 DAY` or `AT 2030-01-01 00:00:00`.
    pub schedule: String,
    /// "ENABLED", "DISABLED" or, on a replica, the one MySQL disables there.
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlStoredPrograms {
    pub routines: Vec<MySqlRoutine>,
    pub triggers: Vec<MySqlTrigger>,
    pub events: Vec<MySqlEvent>,
}

pub(crate) async fn mysql_stored_programs(pool: &MySqlPool, database: &str) -> Result<MySqlStoredPrograms, AppError> {
    let routines: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT ROUTINE_NAME, LOWER(ROUTINE_TYPE), DTD_IDENTIFIER FROM information_schema.ROUTINES \
         WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME, ROUTINE_TYPE",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(AppError::MySql)?;
    let triggers: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION FROM information_schema.TRIGGERS \
         WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(AppError::MySql)?;
    // The scheduler being off stops events running, not their being listed.
    let events: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT EVENT_NAME, CASE EVENT_TYPE WHEN 'ONE TIME' THEN CONCAT('AT ', EXECUTE_AT) \
         ELSE CONCAT('EVERY ', INTERVAL_VALUE, ' ', INTERVAL_FIELD) END, STATUS FROM information_schema.EVENTS \
         WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(AppError::MySql)?;
    Ok(MySqlStoredPrograms {
        routines: routines.into_iter().map(|(name, kind, returns)| MySqlRoutine { name, kind, returns }).collect(),
        triggers: triggers.into_iter().map(|(name, table, timing, event)| MySqlTrigger { name, table, timing, event }).collect(),
        events: events.into_iter().map(|(name, schedule, status)| MySqlEvent { name, schedule, status }).collect(),
    })
}

#[tauri::command]
pub async fn list_mysql_stored_programs(ctx: State<'_, AppContext>, id: String, database: String) -> Result<MySqlStoredPrograms, AppError> {
    mysql_stored_programs(&ctx.mysql_pool(&id, None).await?, &database).await
}
