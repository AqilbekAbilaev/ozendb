use super::{only_reads, Explain};
use crate::error::AppError;

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
fn mysql_8_3_and_later_explain_in_the_second_json_version_and_analyze_a_read() {
    assert_eq!(Explain::of("8.4.13", true), Explain::Iterators { analyze: true });
    assert_eq!(Explain::of("8.3.0-log", false), Explain::Iterators { analyze: false });
    assert_eq!(Explain::of("9.1.0", true), Explain::Iterators { analyze: true });
}

#[test]
fn mysql_8_0_18_to_8_2_analyze_a_read_as_a_tree() {
    for version in ["8.0.18", "8.0.46-log", "8.2.0"] {
        assert_eq!(Explain::of(version, true), Explain::Tree, "{version}");
    }
}

#[test]
fn older_servers_and_writes_before_8_3_are_explained_in_the_classic_json_without_running() {
    for (version, reads) in [("8.2.0", false), ("8.0.46", false), ("8.0.17", true), ("5.7.44-log", true), ("not a version", true)] {
        assert_eq!(Explain::of(version, reads), Explain::Classic, "{version}");
    }
}

#[test]
fn each_way_of_explaining_readies_the_session_it_needs() {
    assert_eq!(Explain::Iterators { analyze: true }.setup(), Some("SET SESSION explain_json_format_version = 2; START TRANSACTION READ ONLY"));
    assert_eq!(Explain::Iterators { analyze: false }.setup(), Some("SET SESSION explain_json_format_version = 2"));
    assert_eq!(Explain::Tree.setup(), Some("START TRANSACTION READ ONLY"));
    assert_eq!(Explain::Classic.setup(), None);
}

#[test]
fn each_way_of_explaining_asks_for_its_own_format() {
    let statement = "SELECT `ü` FROM `a b`";
    assert_eq!(Explain::Iterators { analyze: true }.statement(statement), "EXPLAIN ANALYZE FORMAT=JSON SELECT `ü` FROM `a b`");
    assert_eq!(Explain::Iterators { analyze: false }.statement(statement), "EXPLAIN FORMAT=JSON SELECT `ü` FROM `a b`");
    assert_eq!(Explain::Tree.statement(statement), "EXPLAIN ANALYZE SELECT `ü` FROM `a b`");
    assert_eq!(Explain::Classic.statement(statement), "EXPLAIN FORMAT=JSON SELECT `ü` FROM `a b`");
}

#[test]
fn a_plan_mysql_cannot_show_as_steps_is_refused_without_guessing_the_statement() {
    let refused = Explain::Iterators { analyze: false }.read(String::from(r#"{"operation": "<not executable by iterator executor>"}"#)).unwrap_err();
    assert!(matches!(&refused, AppError::Validation(why) if why.contains("this statement") && !why.contains("single-table")), "{refused}");
}

#[test]
fn any_other_plan_is_read_as_json() {
    assert_eq!(Explain::Iterators { analyze: false }.read(String::from(r#"{"operation": "Insert into `ä b`"}"#)).unwrap()["operation"], "Insert into `ä b`");
    assert_eq!(Explain::Classic.read(String::from(r#"{"query_block": {"select_id": 1}}"#)).unwrap()["query_block"]["select_id"], 1);
}

#[test]
fn a_tree_is_kept_as_the_text_it_is() {
    let tree = "-> Table scan on `ä b`  (cost=0.65 rows=4) (actual time=0.01..0.02 rows=4 loops=1)";
    assert_eq!(Explain::Tree.read(String::from(tree)).unwrap(), serde_json::Value::from(tree));
}
