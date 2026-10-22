use crate::commands::sql::format::format_sql;
use crate::error::AppError;
use sqlparser::dialect::PostgreSqlDialect;

#[tauri::command(async)]
pub fn format_pg_sql(sql: String) -> Result<String, AppError> {
    format_sql(&PostgreSqlDialect {}, &sql).map_err(AppError::Sql)
}
