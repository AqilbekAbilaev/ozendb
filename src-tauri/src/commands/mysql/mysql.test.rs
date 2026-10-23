use super::quote_name;

#[test]
fn backtick_quotes_a_name_doubling_any_backtick_inside_it() {
    assert_eq!(quote_name("order items").unwrap(), "`order items`");
    assert_eq!(quote_name("say `hi`").unwrap(), "`say ``hi```");
    assert_eq!(quote_name("клиенты \"ü\"").unwrap(), "`клиенты \"ü\"`");
}

#[test]
fn refuses_an_empty_name() {
    assert!(quote_name("").is_err());
}
