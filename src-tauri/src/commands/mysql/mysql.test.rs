use super::{quote_account, quote_name};

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

#[test]
fn quotes_each_part_of_an_account_as_a_string_doubling_quotes_and_backslashes() {
    assert_eq!(quote_account("o'brien \\ ü", "10.%"), r"'o''brien \\ ü'@'10.%'");
    assert_eq!(quote_account("a@b", "host'@'x"), "'a@b'@'host''@''x'");
}

#[test]
fn quotes_the_anonymous_account_too() {
    assert_eq!(quote_account("", "localhost"), "''@'localhost'");
}
