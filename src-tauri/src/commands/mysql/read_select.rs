use crate::commands::sql::read_select::{read_table_select, TableDialect, TableSelect};
use crate::error::AppError;
use sqlparser::ast::{Expr, Ident, ObjectName};
use sqlparser::dialect::{Dialect, MySqlDialect};

/// How MySQL's table tab SQL reads (`TableDialect`).
pub(crate) struct MySqlTableDialect;

/// `name` as a bare one-part name, in any case, as MySQL reads a character set or collation.
fn is(object: &ObjectName, name: &str) -> bool {
    matches!(object.0.as_slice(), [part] if part.as_ident().is_some_and(|i| i.value.eq_ignore_ascii_case(name)))
}

impl TableDialect for MySqlTableDialect {
    fn grammar(&self) -> &dyn Dialect {
        &MySqlDialect {}
    }

    /// Taken as written, quoted or not: MySQL folds no name, and matches a column's in any case.
    fn name(&self, ident: &Ident) -> String {
        ident.value.clone()
    }

    /// `CONVERT(column USING utf8mb4) COLLATE utf8mb4_general_ci LIKE pattern`, as SQL mode
    /// writes it (engines/mysql/sql.js): a plain LIKE ignores case only under some collations.
    fn matched<'e>(&self, expr: &'e Expr) -> Option<(&'e Expr, &'e Expr)> {
        let Expr::Like { negated: false, any: false, expr, pattern, escape_char: None } = expr else { return None };
        let Expr::Collate { expr, collation } = expr.as_ref() else { return None };
        let Expr::Convert { is_try: false, expr, data_type: None, charset: Some(charset), .. } = expr.as_ref() else { return None };
        (is(charset, "utf8mb4") && is(collation, "utf8mb4_general_ci")).then_some((expr.as_ref(), pattern.as_ref()))
    }
}

/// Reads a table tab's edited SQL back into its joins, filters, sort and page, or says
/// why it can't be. `database` plays the shared tab's schema. Pure; no connection needed.
#[tauri::command(async)]
pub fn read_mysql_table_select(sql: String, database: String, table: String) -> Result<TableSelect, AppError> {
    read_table_select(&MySqlTableDialect, &sql, &database, &table).map_err(AppError::Sql)
}

#[cfg(test)]
#[path = "read_select.test.rs"]
mod tests;
