use super::*;

#[test]
fn every_session_gets_the_five_minute_time_limit() {
    assert_eq!(setup_statement(false), "SET SESSION max_execution_time = 300000");
}

#[test]
fn a_read_only_session_also_refuses_writes() {
    assert_eq!(
        setup_statement(true),
        "SET SESSION max_execution_time = 300000, SESSION transaction_read_only = ON",
    );
}
