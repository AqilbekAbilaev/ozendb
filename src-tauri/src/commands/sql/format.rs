use sqlparser::dialect::Dialect;
use sqlparser::parser::{Parser, ParserOptions};
use sqlparser::tokenizer::{Token, Tokenizer, Whitespace};

/// The SQL laid out one clause per line, by sqlparser's own pretty-printer (`{:#}`),
/// so formatting needs no dependency of its own. sqlparser drops comments, so SQL with
/// comments is refused rather than returned without them. Read in the engine's `dialect`.
// ponytail: sqlparser's layout, quirks included (ORDER BY stays on the HAVING line); a
// dedicated formatter crate if that isn't good enough.
pub(crate) fn format_sql(dialect: &dyn Dialect, sql: &str) -> Result<String, String> {
    let tokens = Tokenizer::new(dialect, sql).tokenize().map_err(|e| e.to_string())?;
    let is_comment = |t: &Token| matches!(t, Token::Whitespace(Whitespace::SingleLineComment { .. } | Whitespace::MultiLineComment(_)));
    if tokens.iter().any(is_comment) {
        return Err("SQL with comments isn't formatted, since formatting would drop them.".to_string());
    }
    // Escapes kept as written, so each string comes back exactly as typed rather than
    // unescaped and written out again without them.
    let statements = Parser::new(dialect)
        .with_options(ParserOptions::new().with_unescape(false))
        .try_with_sql(sql)
        .and_then(|mut parser| parser.parse_statements())
        .map_err(|e| e.to_string())?;
    if statements.is_empty() {
        return Err("There's no SQL to format.".to_string());
    }
    Ok(statements.iter().map(|s| format!("{s:#};")).collect::<Vec<_>>().join("\n\n"))
}

#[cfg(test)]
#[path = "format.test.rs"]
mod tests;
