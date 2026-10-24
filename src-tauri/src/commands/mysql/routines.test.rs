use super::MySqlDefinitionKind;

fn kind(name: &str) -> MySqlDefinitionKind {
    serde_json::from_value(serde_json::json!(name)).unwrap()
}

#[test]
fn asks_for_a_definition_with_both_names_quoted() {
    assert_eq!(kind("procedure").show_create("shop ü", "p `x`; y").unwrap(), "SHOW CREATE PROCEDURE `shop ü`.`p ``x``; y`");
}

#[test]
fn reads_each_kind_s_create_statement_from_its_own_column() {
    let read = |name: &str| {
        let kind = kind(name);
        (kind.show_create("d", "n").unwrap(), kind.column())
    };
    assert_eq!(read("view"), (String::from("SHOW CREATE VIEW `d`.`n`"), "Create View"));
    assert_eq!(read("function"), (String::from("SHOW CREATE FUNCTION `d`.`n`"), "Create Function"));
    assert_eq!(read("trigger"), (String::from("SHOW CREATE TRIGGER `d`.`n`"), "SQL Original Statement"));
    assert_eq!(read("event"), (String::from("SHOW CREATE EVENT `d`.`n`"), "Create Event"));
}

#[test]
fn refuses_a_kind_it_has_no_definition_for() {
    assert!(serde_json::from_value::<MySqlDefinitionKind>(serde_json::json!("table")).is_err());
}

#[test]
fn says_whose_body_mysql_hides_and_where() {
    let hidden = kind("function").hidden("shop ü", "f ü");
    assert_eq!(
        (hidden.code(), hidden.to_string().as_str()),
        ("forbidden", "MySQL doesn't show this login the body of function `f ü` in `shop ü`: only its definer, or a login with SHOW_ROUTINE or SELECT on every database, may read it.")
    );
}
