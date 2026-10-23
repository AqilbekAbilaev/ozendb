use super::*;

#[test]
fn every_session_gets_the_five_minute_time_limit_backslash_escapes_and_the_users_zone() {
    assert_eq!(
        setup_statement(false),
        format!(
            "SET SESSION max_execution_time = 300000, \
             SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'NO_BACKSLASH_ESCAPES', ''), \
             SESSION time_zone = '{}'",
            zone()
        ),
    );
}

#[test]
fn the_zone_is_an_offset_mysql_takes() {
    let zone = zone();
    assert!(zone.len() == 6 && (zone.starts_with('+') || zone.starts_with('-')) && &zone[3..4] == ":", "{zone}");
}

#[test]
fn a_read_only_session_also_refuses_writes() {
    assert!(setup_statement(true).ends_with(", SESSION transaction_read_only = ON"));
}
