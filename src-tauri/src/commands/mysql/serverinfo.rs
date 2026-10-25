//! The server's global variables and status counters, as SHOW GLOBAL lists them, which
//! any login may read. The summary (version, uptime, connections) is picked out of them
//! by the frontend rather than asked for again.
use crate::error::AppError;
use serde::Serialize;
use sqlx::MySqlPool;
use tauri::State;

use super::AppContext;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlServerValue {
    pub name: String,
    pub value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlServerInfo {
    pub variables: Vec<MySqlServerValue>,
    pub status: Vec<MySqlServerValue>,
}

async fn values(pool: &MySqlPool, statement: &'static str) -> Result<Vec<MySqlServerValue>, sqlx::Error> {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(statement).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|(name, value)| MySqlServerValue { name, value: value.unwrap_or_default() }).collect())
}

pub(crate) async fn mysql_server_info(pool: &MySqlPool) -> Result<MySqlServerInfo, AppError> {
    let (variables, status) = tokio::try_join!(values(pool, "SHOW GLOBAL VARIABLES"), values(pool, "SHOW GLOBAL STATUS")).map_err(AppError::MySql)?;
    Ok(MySqlServerInfo { variables, status })
}

/// Read-only: this reports variables, it never sets them.
#[tauri::command]
pub async fn show_mysql_server_info(ctx: State<'_, AppContext>, id: String) -> Result<MySqlServerInfo, AppError> {
    mysql_server_info(&ctx.mysql_pool(&id, None).await?).await
}
