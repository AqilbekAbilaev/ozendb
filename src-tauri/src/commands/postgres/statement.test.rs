use super::refuse_transaction_control;

#[test]
fn refuses_transaction_control_typed_into_the_editor() {
    for sql in ["BEGIN", "begin; update t set a = 1", "START TRANSACTION", "COMMIT", "rollback", "SAVEPOINT s", "RELEASE SAVEPOINT s", "ROLLBACK TO SAVEPOINT s", "END"] {
        let err = refuse_transaction_control(sql).unwrap_err();
        assert!(err.contains("Manual"), "{sql}: {err}");
    }
}

#[test]
fn lets_everything_else_through() {
    for sql in ["SELECT 1", "UPDATE t SET a = 1", "CREATE TABLE x (id int)", "select 'begin'", "selec 1"] {
        assert!(refuse_transaction_control(sql).is_ok(), "{sql}");
    }
}
