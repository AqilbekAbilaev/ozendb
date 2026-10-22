use crate::commands::sql::read_select::{read_table_select, TableSelect};
use crate::error::AppError;
use sqlparser::dialect::PostgreSqlDialect;

/// Reads a table tab's edited SQL back into its filters, sort and page, or says why
/// it can't be. Pure; no connection needed.
#[tauri::command(async)]
pub fn read_pg_table_select(sql: String, schema: String, table: String) -> Result<TableSelect, AppError> {
    read_table_select(&PostgreSqlDialect {}, &sql, &schema, &table).map_err(AppError::Sql)
}
