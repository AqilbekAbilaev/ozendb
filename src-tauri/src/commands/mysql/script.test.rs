use super::statements;

fn split(sql: &str) -> Vec<&str> {
    statements(sql, false).unwrap()
}

fn refusal(sql: &str, read_only: bool) -> String {
    statements(sql, read_only).unwrap_err().to_string()
}

#[test]
fn splits_a_script_into_its_statements_as_typed() {
    assert_eq!(split("SELECT 1;\n  UPDATE `t` SET a = 2 ;DELETE FROM t"), ["SELECT 1", "UPDATE `t` SET a = 2", "DELETE FROM t"]);
}

#[test]
fn keeps_a_semicolon_inside_quotes_or_a_comment() {
    let sql = "SELECT 'a;b', \"c;d\", `e;f` FROM t -- g;h\n; SELECT 'it\\';s' # i;j\n;/* k;l */ SELECT 2";
    assert_eq!(split(sql), ["SELECT 'a;b', \"c;d\", `e;f` FROM t -- g;h", "SELECT 'it\\';s' # i;j", "/* k;l */ SELECT 2"]);
}

#[test]
fn finds_statements_after_text_that_is_not_ascii() {
    assert_eq!(split("SELECT 'Straße ведомость';\nSELECT 'ü' AS `ö`"), ["SELECT 'Straße ведомость'", "SELECT 'ü' AS `ö`"]);
}

#[test]
fn leaves_out_empty_statements_and_ones_that_are_only_comments() {
    assert_eq!(split(";; SELECT 1;;\n-- the end\n;"), ["SELECT 1"]);
}

#[test]
fn keeps_a_routine_body_whole() {
    let routine = "CREATE PROCEDURE `p ü`() BEGIN\n  DECLARE n INT DEFAULT 0;\n  IF n = 0 THEN SELECT CASE WHEN n THEN 1 END; END IF;\n  \
                   l: LOOP LEAVE l; END LOOP l;\n  CASE n WHEN 0 THEN SELECT 0; END CASE;\n  BEGIN SELECT 2; END;\nEND";
    assert_eq!(split(&format!("{routine};\nCALL `p ü`()")), [routine, "CALL `p ü`()"]);
}

#[test]
fn reads_begin_as_a_column_outside_a_routine() {
    assert_eq!(split("SELECT begin, `end` FROM t; SELECT 2"), ["SELECT begin, `end` FROM t", "SELECT 2"]);
}

#[test]
fn asks_for_sql_when_there_is_none() {
    for sql in ["", "  ;\n", "-- nothing"] {
        assert_eq!(refusal(sql, false), "Enter a query to run.", "{sql:?}");
    }
}

#[test]
fn refuses_sql_it_cannot_read_rather_than_guess_where_statements_end() {
    assert!(refusal("SELECT 1; SELECT 'open", false).contains("couldn't be read"));
}

#[test]
fn refuses_transaction_control_and_autocommit_anywhere_in_the_script() {
    for sql in ["BEGIN", "SELECT 1; begin work", "START TRANSACTION READ WRITE", "COMMIT", "rollback", "SAVEPOINT s",
                "RELEASE SAVEPOINT s", "ROLLBACK TO SAVEPOINT s", "SET autocommit = 0", "SET @@SESSION.autocommit = 0"] {
        assert!(refusal(sql, false).contains("Manual"), "{sql}");
    }
}

#[test]
fn refuses_the_whole_script_before_any_of_it_runs() {
    assert!(statements("UPDATE t SET a = 1; COMMIT", false).is_err());
}

#[test]
fn refuses_what_would_lift_a_read_only_connections_lock() {
    for sql in ["SET SESSION transaction_read_only = OFF", "set transaction_read_only = 0", "SET @@session.transaction_read_only = 0",
                "SET @@transaction_read_only := DEFAULT", "SET GLOBAL transaction_read_only = OFF", "SET LOCAL tx_read_only = 0",
                "SET SESSION TRANSACTION READ WRITE", "SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE",
                "SELECT 1; SET `transaction_read_only` = 0"] {
        assert!(refusal(sql, true).contains("read-only"), "{sql}");
    }
}

#[test]
fn refuses_prepared_statements_on_a_read_only_connection() {
    for sql in ["PREPARE s FROM 'SET SESSION transaction_read_only = OFF'", "execute `s ü`", "DEALLOCATE PREPARE s", "drop prepare s",
                "SELECT 1; EXECUTE s USING @a"] {
        assert!(refusal(sql, true).contains("prepared"), "{sql}");
    }
}

#[test]
fn lets_a_writable_connection_prepare_statements() {
    assert!(statements("PREPARE s FROM 'SELECT 1'; EXECUTE s; DEALLOCATE PREPARE s", false).is_ok());
}

#[test]
fn lets_a_read_only_connection_set_anything_else() {
    for sql in ["SET SESSION TRANSACTION READ ONLY", "SET time_zone = '+05:00'", "SET @note = 'read write'", "SELECT 'transaction_read_only'"] {
        assert!(statements(sql, true).is_ok(), "{sql}");
    }
}

#[test]
fn lets_a_writable_connection_change_its_read_only_mode() {
    assert!(statements("SET SESSION transaction_read_only = ON", false).is_ok());
}
