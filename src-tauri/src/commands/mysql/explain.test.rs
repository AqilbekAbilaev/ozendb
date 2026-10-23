use super::{only_reads, plans_in_json_v2};

#[test]
fn a_select_in_any_of_its_forms_only_reads() {
    for sql in [
        "SELECT `ü` FROM `order lines` WHERE id IN (SELECT id FROM t)",
        "WITH x AS (SELECT 1 AS n) SELECT n FROM x",
        "SELECT 1 UNION SELECT 2",
        "VALUES ROW(1, 'a')",
    ] {
        assert!(only_reads(sql), "{sql}");
    }
}

#[test]
fn a_write_never_counts_as_only_reading() {
    for sql in [
        "DELETE FROM t WHERE id = 1",
        "UPDATE t SET note = 'x'",
        "INSERT INTO t VALUES (1)",
        "REPLACE INTO t VALUES (1)",
        "CREATE TABLE t2 AS SELECT * FROM t",
        "WITH x AS (SELECT 1 AS n) DELETE FROM t WHERE id IN (SELECT n FROM x)",
        "WITH x AS (SELECT 1 AS n) UPDATE t SET note = 'x' WHERE id IN (SELECT n FROM x)",
        "WITH x AS (SELECT 1 AS n) INSERT INTO t SELECT n FROM x",
    ] {
        assert!(!only_reads(sql), "{sql}");
    }
}

#[test]
fn a_select_that_writes_into_a_variable_or_a_file_does_not_only_read() {
    assert!(!only_reads("SELECT id INTO @kept FROM t LIMIT 1"));
    assert!(!only_reads("SELECT * FROM t INTO OUTFILE '/tmp/t.csv'"));
    assert!(!only_reads("SELECT 1 UNION SELECT id INTO @kept FROM t"));
    assert!(!only_reads("WITH x AS (SELECT id INTO @kept FROM t) SELECT 1"));
}

#[test]
fn a_column_or_a_string_named_into_still_only_reads() {
    assert!(only_reads("SELECT `into` FROM t WHERE note = 'INTO'"));
}

#[test]
fn sql_sqlparser_cannot_read_does_not_only_read() {
    assert!(!only_reads("SELECT FROM WHERE"));
    assert!(!only_reads("TABLE `Straße`"));
}

#[test]
fn json_plans_with_iterators_arrive_in_mysql_8_3() {
    assert!(plans_in_json_v2("8.4.13"));
    assert!(plans_in_json_v2("8.3.0-log"));
    assert!(plans_in_json_v2("9.1.0"));
    assert!(!plans_in_json_v2("8.0.36"));
    assert!(!plans_in_json_v2("8.2.0"));
    assert!(!plans_in_json_v2("not a version"));
}
