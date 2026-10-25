use super::*;

fn change(database: Option<&str>, table: Option<&str>, privileges: &[&str]) -> MySqlPrivilegeChange {
    MySqlPrivilegeChange {
        user: String::from("o'brien ü"),
        host: String::from("10.%"),
        database: database.map(String::from),
        table: table.map(String::from),
        privileges: privileges.iter().map(|p| p.to_string()).collect(),
        grant_option: false,
    }
}

fn validation_message(result: Result<String, AppError>) -> String {
    match result {
        Err(AppError::Validation(message)) => message,
        other => panic!("expected a validation error, got {other:?}"),
    }
}

#[test]
fn grants_on_a_table_quote_its_database_its_table_and_the_account() {
    let sql = privilege_statement(&change(Some("shop `eu`"), Some("order items"), &["select", "INSERT"]), true).unwrap();
    assert_eq!(sql, "GRANT SELECT, INSERT ON `shop ``eu```.`order items` TO 'o''brien ü'@'10.%'");
}

#[test]
fn a_database_without_a_table_means_every_table_in_it_and_no_database_the_whole_server() {
    let database = privilege_statement(&change(Some("shop"), None, &["EXECUTE"]), true).unwrap();
    assert_eq!(database, "GRANT EXECUTE ON `shop`.* TO 'o''brien ü'@'10.%'");
    let server = privilege_statement(&change(None, None, &["PROCESS"]), true).unwrap();
    assert_eq!(server, "GRANT PROCESS ON *.* TO 'o''brien ü'@'10.%'");
}

#[test]
fn privileges_are_listed_in_a_fixed_order_whatever_order_they_were_chosen_in() {
    let sql = privilege_statement(&change(None, None, &["PROCESS", "DELETE", "SELECT"]), true).unwrap();
    assert!(sql.starts_with("GRANT SELECT, DELETE, PROCESS ON"), "{sql}");
}

#[test]
fn the_grant_option_is_granted_with_and_revoked_alongside_the_privileges() {
    let mut granting = change(Some("shop"), None, &["SELECT"]);
    granting.grant_option = true;
    assert_eq!(privilege_statement(&granting, true).unwrap(), "GRANT SELECT ON `shop`.* TO 'o''brien ü'@'10.%' WITH GRANT OPTION");
    assert_eq!(privilege_statement(&granting, false).unwrap(), "REVOKE SELECT, GRANT OPTION ON `shop`.* FROM 'o''brien ü'@'10.%'");
    assert_eq!(privilege_statement(&change(Some("shop"), None, &["SELECT"]), false).unwrap(), "REVOKE SELECT ON `shop`.* FROM 'o''brien ü'@'10.%'");
}

#[test]
fn refuses_a_privilege_the_level_does_not_take() {
    let message = validation_message(privilege_statement(&change(Some("shop"), Some("t"), &["EXECUTE"]), true));
    assert_eq!(message, "EXECUTE doesn't apply to a table.");
    let message = validation_message(privilege_statement(&change(Some("shop"), None, &["SELECT; DROP DATABASE shop"]), true));
    assert_eq!(message, "SELECT; DROP DATABASE SHOP doesn't apply to a database.");
}

#[test]
fn refuses_a_change_with_no_privileges() {
    assert_eq!(validation_message(privilege_statement(&change(None, None, &[]), true)), "Choose at least one privilege.");
}

#[test]
fn refuses_a_table_without_its_database_or_a_blank_name() {
    assert_eq!(validation_message(privilege_statement(&change(None, Some("t"), &["SELECT"]), true)), "Name the database the table is in.");
    assert!(privilege_statement(&change(Some(""), None, &["SELECT"]), true).is_err());
}
