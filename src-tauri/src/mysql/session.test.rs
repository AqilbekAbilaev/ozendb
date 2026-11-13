use super::*;

#[test]
fn a_version_naming_mariadb_is_recognised_as_mariadb() {
    assert_eq!(Flavor::of("11.4.13-MariaDB-ubu2404"), Flavor::MariaDb);
}

#[test]
fn a_version_without_mariadb_is_recognised_as_mysql() {
    assert_eq!(Flavor::of("8.4.13"), Flavor::MySql);
}

#[test]
fn every_mysql_session_gets_the_five_minute_time_limit_backslash_escapes_and_utc() {
    assert_eq!(
        setup_statement(Flavor::MySql, false),
        "SET SESSION max_execution_time = 300000, \
         SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'NO_BACKSLASH_ESCAPES', ''), \
         SESSION time_zone = '+00:00'",
    );
}

#[test]
fn every_mariadb_session_gets_the_five_minute_time_limit_in_seconds() {
    assert!(setup_statement(Flavor::MariaDb, false).starts_with("SET SESSION max_statement_time = 300, "));
}

#[test]
fn a_mariadb_session_never_names_the_mysql_time_limit() {
    assert!(!setup_statement(Flavor::MariaDb, true).contains("max_execution_time"));
}

#[test]
fn a_read_only_mysql_session_also_refuses_writes() {
    assert!(setup_statement(Flavor::MySql, true).ends_with("; SET SESSION TRANSACTION READ ONLY"));
}

#[test]
fn a_read_only_mariadb_session_also_refuses_writes() {
    assert!(setup_statement(Flavor::MariaDb, true).ends_with("; SET SESSION TRANSACTION READ ONLY"));
}

#[test]
fn a_writable_session_never_asks_for_read_only() {
    assert!(!setup_statement(Flavor::MariaDb, false).contains("READ ONLY"));
}

#[test]
fn an_unlimited_mysql_session_lifts_its_own_time_limit() {
    assert_eq!(unlimited(Flavor::MySql), "SET SESSION max_execution_time = 0");
}

#[test]
fn an_unlimited_mariadb_session_lifts_its_own_time_limit() {
    assert_eq!(unlimited(Flavor::MariaDb), "SET SESSION max_statement_time = 0");
}
