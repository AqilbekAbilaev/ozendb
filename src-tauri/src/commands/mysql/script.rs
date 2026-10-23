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
/// connection, would lift its read-only mode: a session can do that to itself, directly
/// or through a prepared statement, whose SQL is text this check never reads.
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
        if read_only && is_prepared_statement(words) {
            return Err(AppError::Validation(String::from("A read-only connection can't run prepared statements.")));
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
        // Only a routine's body holds statements that end in `;`: it opens with a BEGIN
        // (see `opens_body`), and inside it BEGIN and CASE open blocks that END closes.
        let next = significant.get(i + 1).map_or("", |n| keyword(&n.token));
        match keyword(&t.token) {
            "BEGIN" if depth == 0 && opens_body(&words) => depth += 1,
            "BEGIN" | "CASE" if depth > 0 && words.last().is_none_or(|w| w != "END") => depth += 1,
            "END" if !["IF", "LOOP", "WHILE", "REPEAT"].contains(&next) => depth = depth.saturating_sub(1),
            _ => {}
        }
        words.push(t.token.to_string().to_uppercase());
    }
    finish(start, sql.len(), words);
    Ok(statements)
}

/// Whether a BEGIN after `words` opens a routine's body: a CREATE [DEFINER = …] PROCEDURE,
/// FUNCTION, TRIGGER or EVENT, outside any parentheses, right where its header ends (or
/// after the body's label). Anywhere else BEGIN is a name, such as a column's.
fn opens_body(words: &[String]) -> bool {
    let word = |i: usize| words.get(i).map_or("", String::as_str);
    let last = |n: usize| words.len().checked_sub(n).map_or("", word);
    let parenthesized = words.iter().filter(|w| *w == "(").count() > words.iter().filter(|w| *w == ")").count();
    if word(0) != "CREATE" || parenthesized {
        return false;
    }
    let header_ends = match word(routine_at(words)) {
        "PROCEDURE" => last(1) == ")" || last(1).starts_with(['\'', '"']) || ["DETERMINISTIC", "SQL", "DATA", "DEFINER", "INVOKER"].contains(&last(1)),
        // Its only other body is a RETURN, and its header has no unquoted RETURN.
        "FUNCTION" => words.iter().any(|w| w == "RETURNS") && !words.iter().any(|w| w == "RETURN"),
        "TRIGGER" => last(1) == "ROW" || ["FOLLOWS", "PRECEDES"].contains(&last(2)),
        "EVENT" => last(1) == "DO",
        _ => return false,
    };
    header_ends || last(1) == ":"
}

/// Where the kind of thing a CREATE makes is named in its `words`: after the DEFINER
/// clause, if it has one (`'u'@'h'`, `u@h` or `CURRENT_USER()`).
fn routine_at(words: &[String]) -> usize {
    if words.get(1).is_none_or(|w| w != "DEFINER") {
        return 1;
    }
    let follows = |i: usize, w: &str| words.get(i + 1).is_some_and(|next| next == w);
    let mut at = 3;
    if follows(at, "@") {
        at += 2;
    }
    if follows(at, "(") {
        at += 2;
    }
    at + 1
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

/// PREPARE, EXECUTE, and DEALLOCATE or DROP PREPARE.
fn is_prepared_statement(words: &[String]) -> bool {
    match words {
        [first, ..] if first == "PREPARE" || first == "EXECUTE" => true,
        [first, second, ..] => (first == "DEALLOCATE" || first == "DROP") && second == "PREPARE",
        _ => false,
    }
}

#[cfg(test)]
#[path = "script.test.rs"]
mod tests;
