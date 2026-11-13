use super::*;

fn user(name: &str, password: Option<&str>) -> NewMySqlUser {
    NewMySqlUser { user: String::from(name), host: String::from("%"), password: password.map(String::from) }
}

#[test]
fn creates_an_account_with_its_password_quoted_as_a_string() {
    let sql = create_statement(&user("o'brien ü", Some(r"pa'ss\word"))).unwrap();
    assert_eq!(sql, r"CREATE USER 'o''brien ü'@'%' IDENTIFIED BY 'pa''ss\\word'");
}

#[test]
fn creates_an_account_without_a_password_when_none_is_given() {
    assert_eq!(create_statement(&user("app", None)).unwrap(), "CREATE USER 'app'@'%'");
}

#[test]
fn refuses_an_account_without_a_user_name_or_a_host() {
    assert!(matches!(create_statement(&user(" ", None)), Err(AppError::Validation(_))));
    let no_host = NewMySqlUser { host: String::new(), ..user("app", None) };
    assert!(matches!(create_statement(&no_host), Err(AppError::Validation(_))));
}

#[test]
fn lists_accounts_on_mysql_from_the_user_table_with_its_lock_column() {
    assert!(listing(Flavor::MySql).contains("account_locked = 'Y'"));
}

#[test]
fn reads_the_lock_of_a_mariadb_account_from_its_global_privileges() {
    assert!(listing(Flavor::MariaDb).contains("JSON_VALUE(g.Priv, '$.account_locked')"));
}

#[test]
fn leaves_mariadb_roles_out_of_the_account_list() {
    assert!(listing(Flavor::MariaDb).contains("u.is_role = 'N'"));
}

#[test]
fn never_asks_mysql_for_the_mariadb_global_privileges() {
    assert!(!listing(Flavor::MySql).contains("global_priv"));
}

#[test]
fn takes_the_mariadb_built_in_account_for_a_system_account() {
    assert!(is_system("mariadb.sys"));
}

#[test]
fn takes_the_mysql_built_in_accounts_for_system_accounts() {
    assert!(is_system("mysql.infoschema"));
}

#[test]
fn takes_an_ordinary_account_for_no_system_account() {
    assert!(!is_system("mariadb"));
}

#[test]
fn names_the_global_privileges_table_when_mariadb_denies_the_listing() {
    assert!(denied(Flavor::MariaDb).contains("mysql.global_priv"));
}

#[test]
fn keeps_the_mysql_denial_text_as_it_was() {
    assert_eq!(denied(Flavor::MySql), "MySQL doesn't show this login the server's accounts: listing them needs SELECT on mysql.user.");
}

#[test]
fn leaves_the_password_hash_out_of_a_mariadb_grant() {
    assert_eq!(credential_free("GRANT USAGE ON *.* TO `o'brien \\ ü`@`%` IDENTIFIED BY PASSWORD '*58DB0F3A1E'"), "GRANT USAGE ON *.* TO `o'brien \\ ü`@`%`");
}

#[test]
fn keeps_the_grant_option_after_a_mariadb_authentication_clause() {
    assert_eq!(
        credential_free("GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` IDENTIFIED VIA mysql_native_password USING '*A4B6' OR unix_socket WITH GRANT OPTION"),
        "GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` WITH GRANT OPTION",
    );
}

#[test]
fn keeps_a_mysql_grant_as_it_is() {
    assert_eq!(credential_free("GRANT SELECT ON `shop`.* TO `ann`@`%`"), "GRANT SELECT ON `shop`.* TO `ann`@`%`");
}
