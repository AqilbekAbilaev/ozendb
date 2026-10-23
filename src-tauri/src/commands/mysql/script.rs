//! The SQL tab's text as the statements it runs, one at a time, and the ones refused
//! before any of it runs. MySQL prepares one statement at a time, so a script is split
//! here, by sqlparser's tokenizer in the MySQL dialect: a `;` in a quote or a comment
//! doesn't end a statement, and neither does one inside a routine's BEGIN … END.
use sqlparser::dialect::MySqlDialect;
use sqlparser::tokenizer::{Location, Token, Tokenizer};

use crate::commands::sql::statement::refuse_transaction_control;
use crate::error::AppError;

/// The statements in `sql`, each as typed, in order. Refused whole if any of them
/// controls a transaction (see `refuse_transaction_control`), or, on a `read_only`
/// connection, would lift its read-only mode: a session can do that to itself.
pub(super) fn statements(sql: &str, read_only: bool) -> Result<Vec<&str>, AppError> {
    let split = split(sql)?;
    if split.is_empty() {
        return Err(AppError::Validation(String::from("Enter a query to run.")));
    }
    for (text, words) in &split {
        refuse_transaction_control(&MySqlDialect {}, text).map_err(AppError::Validation)?;
        if is_set(words, &["AUTOCOMMIT"]) {
            return Err(AppError::Validation(String::from("Transactions are run with the Manual switch, not by turning autocommit off.")));
        }
        if read_only && (is_set(words, &["TRANSACTION_READ_ONLY", "TX_READ_ONLY"]) || is_set_read_write(words)) {
            return Err(AppError::Validation(String::from("A read-only connection can't turn its read-only mode off.")));
        }
    }
    Ok(split.into_iter().map(|(text, _)| text).collect())
}

/// Each statement's text and its words, uppercased, leaving out the ones with no words.
fn split(sql: &str) -> Result<Vec<(&str, Vec<String>)>, AppError> {
    let tokens = Tokenizer::new(&MySqlDialect {}, sql)
        .tokenize_with_location()
        .map_err(|e| AppError::Validation(format!("The SQL couldn't be read: {e}.")))?;
    let significant: Vec<_> = tokens.iter().filter(|t| !matches!(t.token, Token::Whitespace(_))).collect();
    let mut statements = Vec::new();
    let (mut start, mut words, mut depth) = (0, Vec::new(), 0usize);
    let mut finish = |start: usize, end: usize, words: Vec<String>| {
        if !words.is_empty() {
            statements.push((sql[start..end].trim(), words));
        }
    };
    for (i, t) in significant.iter().enumerate() {
        if t.token == Token::SemiColon && depth == 0 {
            let at = offset(sql, t.span.start);
            finish(start, at, std::mem::take(&mut words));
            start = at + 1;
            continue;
        }
        // Only a CREATE has a body whose statements end in `;` (a procedure, function,
        // trigger or event), so only there do BEGIN and CASE open a block that END closes.
        if words.first().is_some_and(|w| w == "CREATE") {
            let next = significant.get(i + 1).map_or("", |n| keyword(&n.token));
            match keyword(&t.token) {
                "BEGIN" | "CASE" if words.last().is_none_or(|w| w != "END") => depth += 1,
                "END" if !["IF", "LOOP", "WHILE", "REPEAT"].contains(&next) => depth = depth.saturating_sub(1),
                _ => {}
            }
        }
        words.push(t.token.to_string().to_uppercase());
    }
    finish(start, sql.len(), words);
    Ok(statements)
}

/// An unquoted word as the keyword it may be, in capitals; empty for anything else.
fn keyword(token: &Token) -> &'static str {
    match token {
        Token::Word(word) if word.quote_style.is_none() => ["BEGIN", "CASE", "END", "IF", "LOOP", "WHILE", "REPEAT"]
            .into_iter()
            .find(|k| word.value.eq_ignore_ascii_case(k))
            .unwrap_or_default(),
        _ => "",
    }
}

/// The byte where a token the tokenizer placed at `at` (a line and a character, both
/// counted from 1) starts in `sql`.
fn offset(sql: &str, at: Location) -> usize {
    let line = sql.split_inclusive('\n').take(at.line as usize - 1).map(str::len).sum::<usize>();
    sql[line..].char_indices().nth(at.column as usize - 1).map_or(sql.len(), |(i, _)| line + i)
}

/// A SET of any of `variables`, however named: `SET @@x`, `SET GLOBAL x`, `` SET `x` ``.
fn is_set(words: &[String], variables: &[&str]) -> bool {
    let named = |word: &String| variables.contains(&word.trim_start_matches('@').trim_matches('`').rsplit('.').next().unwrap_or_default());
    words.first().is_some_and(|w| w == "SET") && words.iter().any(named)
}

/// `SET [SESSION] TRANSACTION … READ WRITE`.
fn is_set_read_write(words: &[String]) -> bool {
    words.first().is_some_and(|w| w == "SET") && words.windows(2).any(|pair| pair == ["READ", "WRITE"])
}

#[cfg(test)]
#[path = "script.test.rs"]
mod tests;
