use crate::commands::sql::read_select::{read_table_select, TableDialect, TableSelect};
use crate::error::AppError;
use sqlparser::ast::{DataType, Expr, Ident};
use sqlparser::dialect::Dialect;
use super::DIALECT;

/// How PostgreSQL's table tab SQL reads (`TableDialect`).
pub(crate) struct PgTableDialect;

impl TableDialect for PgTableDialect {
    fn grammar(&self) -> &dyn Dialect {
        &DIALECT
    }

    /// Postgres folds an unquoted name to lower case; a quoted one is taken as written.
    fn name(&self, ident: &Ident) -> String {
        match ident.quote_style {
            Some(_) => ident.value.clone(),
            None => ident.value.to_lowercase(),
        }
    }

    /// `column::text ILIKE pattern`, the cast optional.
    fn matched<'e>(&self, expr: &'e Expr) -> Option<(&'e Expr, &'e Expr)> {
        let Expr::ILike { negated: false, any: false, expr, pattern, escape_char: None } = expr else { return None };
        let column = match expr.as_ref() {
            Expr::Cast { expr, data_type: DataType::Text, .. } => expr.as_ref(),
            other => other,
        };
        Some((column, pattern.as_ref()))
    }
}

/// Reads a table tab's edited SQL back into its filters, sort and page, or says why
/// it can't be. Pure; no connection needed.
#[tauri::command(async)]
pub fn read_pg_table_select(sql: String, schema: String, table: String) -> Result<TableSelect, AppError> {
    read_table_select(&PgTableDialect, &sql, &schema, &table).map_err(AppError::Sql)
}
