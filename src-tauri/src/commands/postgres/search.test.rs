use super::sql_literal;

#[test]
fn sql_literal_quotes_a_plain_name() {
    assert_eq!(sql_literal("widgets"), "'widgets'");
}

#[test]
fn sql_literal_doubles_an_embedded_quote() {
    // Postgres allows almost anything in a quoted identifier, including a single
    // quote — this is what keeps a table/column named like that from breaking out
    // of the string literal it's spliced into for display.
    assert_eq!(sql_literal("it's"), "'it''s'");
}
