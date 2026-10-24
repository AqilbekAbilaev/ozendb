//! The sidebar's stored programs: each database's procedures, functions, triggers and
//! events, read from information_schema, which lists only what the login may see; and
//! the statement that creates any of them, or a view.
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{MySqlPool, Row};
use tauri::State;

use super::{quote_name, AppContext};

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

/// What a definition is asked of. SHOW CREATE gives the whole statement, ready to run
/// again, rather than information_schema's bare body.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum MySqlDefinitionKind {
    View,
    Procedure,
    Function,
    Trigger,
    Event,
}

impl MySqlDefinitionKind {
    fn word(self) -> &'static str {
        match self {
            Self::View => "view",
            Self::Procedure => "procedure",
            Self::Function => "function",
            Self::Trigger => "trigger",
            Self::Event => "event",
        }
    }

    fn show_create(self, database: &str, name: &str) -> Result<String, AppError> {
        Ok(format!("SHOW CREATE {} {}.{}", self.word().to_uppercase(), quote_name(database)?, quote_name(name)?))
    }

    fn column(self) -> &'static str {
        match self {
            Self::View => "Create View",
            Self::Procedure => "Create Procedure",
            Self::Function => "Create Function",
            Self::Trigger => "SQL Original Statement",
            Self::Event => "Create Event",
        }
    }

    /// Why a routine came back with no body: MySQL shows one to a login that may only run,
    /// change or create it, and leaves its body out. SHOW_ROUTINE came with 8.0.20; before
    /// it, SELECT on every database was the definer's only peer, and 8.0 and 8.4 still
    /// accept either.
    fn hidden(self, database: &str, name: &str) -> AppError {
        AppError::Forbidden(format!(
            "MySQL doesn't show this login the body of {} `{name}` in `{database}`: only its definer, or a login with SHOW_ROUTINE or SELECT on every database, may read it.",
            self.word()
        ))
    }
}

/// The statement that creates `database`.`name`.
pub(crate) async fn mysql_definition(pool: &MySqlPool, database: &str, kind: MySqlDefinitionKind, name: &str) -> Result<String, AppError> {
    let row = sqlx::query(sqlx::AssertSqlSafe(kind.show_create(database, name)?)).fetch_one(pool).await.map_err(AppError::MySql)?;
    let definition: Option<String> = row.try_get(kind.column()).map_err(AppError::MySql)?;
    definition.ok_or_else(|| kind.hidden(database, name))
}

#[tauri::command]
pub async fn show_mysql_definition(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    kind: MySqlDefinitionKind,
    name: String,
) -> Result<String, AppError> {
    mysql_definition(&ctx.mysql_pool(&id, None).await?, &database, kind, &name).await
}

#[cfg(test)]
#[path = "routines.test.rs"]
mod tests;
