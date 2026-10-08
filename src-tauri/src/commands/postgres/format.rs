use crate::error::AppError;
use sqlparser::dialect::PostgreSqlDialect;
use sqlparser::parser::Parser;
use sqlparser::tokenizer::{Token, Tokenizer, Whitespace};

/// The SQL laid out one clause per line, by sqlparser's own pretty-printer (`{:#}`),
/// so formatting needs no dependency of its own. sqlparser drops comments, so SQL with
/// comments is refused rather than returned without them.
// ponytail: sqlparser's layout, quirks included (ORDER BY stays on the HAVING line); a
// dedicated formatter crate if that isn't good enough.
pub(crate) fn format_sql(sql: &str) -> Result<String, String> {
    let dialect = PostgreSqlDialect {};
    let tokens = Tokenizer::new(&dialect, sql).tokenize().map_err(|e| e.to_string())?;
    let is_comment = |t: &Token| matches!(t, Token::Whitespace(Whitespace::SingleLineComment { .. } | Whitespace::MultiLineComment(_)));
    if tokens.iter().any(is_comment) {
        return Err("SQL with comments isn't formatted, since formatting would drop them.".to_string());
    }
    let statements = Parser::parse_sql(&dialect, sql).map_err(|e| e.to_string())?;
    if statements.is_empty() {
        return Err("There's no SQL to format.".to_string());
    }
    Ok(statements.iter().map(|s| format!("{s:#};")).collect::<Vec<_>>().join("\n\n"))
}

#[tauri::command(async)]
pub fn format_pg_sql(sql: String) -> Result<String, AppError> {
    format_sql(&sql).map_err(AppError::Sql)
}

#[cfg(test)]
#[path = "format.test.rs"]
mod tests;
