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
fn keeps_each_kind_of_routine_body_whole_whoever_defines_it() {
    for routine in [
        "CREATE DEFINER = 'root'@'%' PROCEDURE p(IN `begin` INT) COMMENT 'a; b' NOT DETERMINISTIC BEGIN SELECT 1; END",
        "CREATE DEFINER=`ü`@`h` FUNCTION f(n INT) RETURNS VARCHAR(10) CHARSET utf8mb4 DETERMINISTIC BEGIN RETURN 'x;'; END",
        "CREATE FUNCTION f() RETURNS INT l: BEGIN RETURN 1; END l",
        "create definer = current_user() trigger tr before insert on t for each row follows other begin set new.a = 1; end",
        "CREATE EVENT e ON SCHEDULE EVERY 1 DAY DO BEGIN DELETE FROM t; END",
    ] {
        assert_eq!(split(&format!("{routine}; SELECT 2")), [routine, "SELECT 2"]);
    }
}

#[test]
fn reads_begin_as_a_name_where_no_routine_body_can_start() {
    for sql in [
        "CREATE TABLE t (begin INT); INSERT INTO t VALUES (1)",
        "CREATE TABLE begin (id INT); INSERT INTO t VALUES (1)",
        "CREATE PROCEDURE p(begin INT) SELECT begin; INSERT INTO t VALUES (1)",
        "CREATE FUNCTION f() RETURNS INT RETURN begin; INSERT INTO t VALUES (1)",
        "CREATE TRIGGER tr BEFORE INSERT ON begin FOR EACH ROW SET NEW.begin = 1; INSERT INTO t VALUES (1)",
    ] {
        let (create, insert) = sql.split_once("; ").unwrap();
        assert_eq!(split(sql), [create, insert], "{sql}");
    }
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

#[test]
fn refuses_a_call_on_a_read_only_connection() {
    for sql in ["CALL `report ü`()", "call shop.p", "SELECT 1; Call p(1, 'a;b')"] {
        assert!(refusal(sql, true).contains("can't call a stored procedure"), "{sql}");
    }
}

#[test]
fn lets_a_writable_connection_call_a_procedure_and_a_read_only_one_select_a_column_named_call() {
    assert!(statements("CALL `report ü`()", false).is_ok());
    assert!(statements("SELECT `call` FROM t", true).is_ok());
}
