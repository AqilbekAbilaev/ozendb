use crate::commands::sql::format::format_sql;
use crate::error::AppError;
use super::DIALECT;

#[tauri::command(async)]
pub fn format_pg_sql(sql: String) -> Result<String, AppError> {
    format_sql(&DIALECT, &sql).map_err(AppError::Sql)
}
