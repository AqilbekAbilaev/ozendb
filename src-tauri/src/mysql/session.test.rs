use super::*;

#[test]
fn every_session_gets_the_five_minute_time_limit_backslash_escapes_and_utc() {
    assert_eq!(
        setup_statement(false),
        "SET SESSION max_execution_time = 300000, \
         SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'NO_BACKSLASH_ESCAPES', ''), \
         SESSION time_zone = '+00:00'",
    );
}

#[test]
fn a_read_only_session_also_refuses_writes() {
    assert!(setup_statement(true).ends_with(", SESSION transaction_read_only = ON"));
}
