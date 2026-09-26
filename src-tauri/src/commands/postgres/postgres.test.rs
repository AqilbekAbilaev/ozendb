use super::quote_ident;

#[test]
fn quote_ident_wraps_a_plain_name() {
    assert_eq!(quote_ident("users").unwrap(), "\"users\"");
}

#[test]
fn quote_ident_doubles_embedded_quotes() {
    // The name `a"b` must become `"a""b"` — a literal double quote inside a
    // quoted identifier is escaped by doubling it, not backslash-escaped.
    assert_eq!(quote_ident("a\"b").unwrap(), "\"a\"\"b\"");
}

#[test]
fn quote_ident_rejects_empty() {
    assert_eq!(quote_ident("").unwrap_err().code(), "validation");
}
