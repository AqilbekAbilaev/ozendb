//! Integration tests against a live PostgreSQL for the `commands::postgres::*`
//! command layer (schema browsing, query, row edit) — split out of
//! `pg_integration_tests.rs` once that file grew past the size limit, since
//! most of what got added here is one regression test per review finding.
//! Shares that file's `test_config`/`pool` helpers and skip behavior; see its
//! module doc comment for how to run these.

use crate::commands::{
    browse_table_impl, count_table_impl, list_columns_impl, list_databases_impl, list_schemas_impl,
    list_tables_impl, run_query_impl, update_row_impl, ColumnValue,
};
use crate::pg_integration_tests::{pool, test_config};

#[tokio::test]
async fn postgres_commands_round_trip() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;

    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it CASCADE",
        "CREATE SCHEMA ozendb_it",
        "CREATE TABLE ozendb_it.widgets (id SERIAL PRIMARY KEY, name TEXT NOT NULL, qty INT NOT NULL DEFAULT 0)",
        "INSERT INTO ozendb_it.widgets (name, qty) VALUES ('a', 1), ('b', 2), ('c', 3)",
    ] {
        match sqlx::query(stmt).execute(&pool).await {
            Ok(_) => {}
            Err(e) => panic!("setup ({stmt}): {e}"),
        }
    }

    // list_pg_databases — this connection's own database is on the server.
    let databases = list_databases_impl(&pool).await.unwrap();
    assert!(!databases.is_empty(), "expected at least one database");

    // list_pg_schemas — the fresh schema shows up, flagged non-system.
    let schemas = list_schemas_impl(&pool).await.unwrap();
    let ours = schemas.iter().find(|s| s.name == "ozendb_it").expect("schema listed");
    assert!(!ours.system);
    assert!(schemas.iter().any(|s| s.name == "pg_catalog" && s.system));

    // list_pg_tables
    let tables = list_tables_impl(&pool, "ozendb_it").await.unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].name, "widgets");
    assert_eq!(tables[0].kind, "table");

    // list_pg_columns — id is the primary key, name/qty aren't.
    let columns = list_columns_impl(&pool, "ozendb_it", "widgets").await.unwrap();
    let by_name: std::collections::HashMap<&str, _> =
        columns.iter().map(|c| (c.name.as_str(), c)).collect();
    assert!(by_name["id"].is_primary_key);
    assert!(!by_name["name"].is_primary_key);
    assert_eq!(by_name["qty"].data_type, "integer");

    // run_pg_query — arbitrary read SQL comes back as rows-of-arrays, in column order.
    let result = run_query_impl(&pool, "SELECT id, name, qty FROM ozendb_it.widgets ORDER BY id", false)
        .await
        .unwrap();
    assert_eq!(result.columns, vec!["id", "name", "qty"]);
    assert_eq!(result.rows.len(), 3);
    assert_eq!(result.rows[0][1], serde_json::json!("a"));
    assert!(!result.truncated);

    // browse_pg_table — paged, ordered by qty descending.
    let page = browse_table_impl(&pool, "ozendb_it", "widgets", Some("qty"), true, 2, 0)
        .await
        .unwrap();
    assert_eq!(page.rows.len(), 2);
    assert_eq!(page.rows[0][1], serde_json::json!("c"));

    // count_pg_table
    let total = count_table_impl(&pool, "ozendb_it", "widgets").await.unwrap();
    assert_eq!(total, 3);

    // update_pg_row — edit by primary key, then verify the change stuck.
    let affected = update_row_impl(
        &pool,
        "ozendb_it",
        "widgets",
        &[ColumnValue { column: String::from("qty"), value: serde_json::json!(99) }],
        &[ColumnValue { column: String::from("id"), value: serde_json::json!(1) }],
    )
    .await
    .unwrap();
    assert_eq!(affected, 1);
    let verify = run_query_impl(&pool, "SELECT qty FROM ozendb_it.widgets WHERE id = 1", false)
        .await
        .unwrap();
    assert_eq!(verify.rows[0][0], serde_json::json!(99));

    // update_pg_row rejects a WHERE that omits a primary-key column, rather than
    // running an update that could silently match more than one row.
    let err = update_row_impl(
        &pool,
        "ozendb_it",
        "widgets",
        &[ColumnValue { column: String::from("qty"), value: serde_json::json!(1) }],
        &[ColumnValue { column: String::from("name"), value: serde_json::json!("a") }],
    )
    .await
    .unwrap_err();
    assert_eq!(err.code(), "validation");

    match sqlx::query("DROP SCHEMA ozendb_it CASCADE").execute(&pool).await {
        Ok(_) => {}
        Err(e) => panic!("drop schema: {}", e),
    }
}

#[tokio::test]
async fn duplicate_and_unnamed_columns_are_not_dropped() {
    // Regression for a real bug: decoding each row as one JSON *object* (keyed by
    // column name) silently collapsed `SELECT 1, 2` to one column (both named
    // `?column?`) and `SELECT a.id, b.id FROM a JOIN b` to one column too. Rows
    // as arrays, with names from a separate describe, must keep both.
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;

    let anonymous = run_query_impl(&pool, "SELECT 1, 2", false).await.unwrap();
    assert_eq!(anonymous.columns.len(), 2);
    assert_eq!(anonymous.rows[0], vec![serde_json::json!(1), serde_json::json!(2)]);

    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_dup CASCADE",
        "CREATE SCHEMA ozendb_it_dup",
        "CREATE TABLE ozendb_it_dup.a (id INT)",
        "CREATE TABLE ozendb_it_dup.b (id INT)",
        "INSERT INTO ozendb_it_dup.a VALUES (1)",
        "INSERT INTO ozendb_it_dup.b VALUES (2)",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }
    let joined = run_query_impl(
        &pool,
        "SELECT a.id, b.id FROM ozendb_it_dup.a AS a, ozendb_it_dup.b AS b",
        false,
    )
    .await
    .unwrap();
    assert_eq!(joined.columns.len(), 2, "both `id` columns must be reported, not collapsed to one");
    assert_eq!(joined.rows[0], vec![serde_json::json!(1), serde_json::json!(2)]);

    sqlx::query("DROP SCHEMA ozendb_it_dup CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn a_trailing_line_comment_does_not_break_the_wrapper() {
    // Regression: `run_wrapped` used to close its subquery on the same line as
    // `inner_sql`, so a query ending in `-- comment` commented out the `) AS t`
    // that followed and failed with a Postgres syntax error.
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let result = run_query_impl(&pool, "SELECT 1 AS a -- trailing comment", false).await.unwrap();
    assert_eq!(result.rows[0], vec![serde_json::json!(1)]);
}

#[tokio::test]
async fn numeric_precision_survives_the_round_trip() {
    // Regression: `to_json` renders `numeric` with full precision, but decoding
    // that text as a bare JSON number (this crate's serde_json has no
    // `arbitrary_precision`) would silently round it to the nearest f64 —
    // wrong in the grid, and a numeric primary key would then fail to match
    // anything in `update_pg_row`. Cast to text server-side instead.
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let result = run_query_impl(&pool, "SELECT 12345678901234567890.123456789::numeric", false).await.unwrap();
    assert_eq!(result.rows[0][0], serde_json::json!("12345678901234567890.123456789"));
}

#[tokio::test]
async fn char_length_and_json_string_values_survive_an_edit() {
    // Two regressions in one table: (1) `information_schema.columns.data_type`
    // drops a `char(n)`'s length modifier ("character(10)" reported as plain
    // "character", which means char(1) — saving a longer string truncated it to
    // one character); (2) a JSON *string* value sent to a json/jsonb column must
    // be quoted (`"hi"`), not passed through bare (`hi`, which isn't valid JSON
    // input at all and made the whole row save fail).
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;

    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_types CASCADE",
        "CREATE SCHEMA ozendb_it_types",
        "CREATE TABLE ozendb_it_types.t (id INT PRIMARY KEY, tag CHAR(10), payload JSONB)",
        "INSERT INTO ozendb_it_types.t (id, tag, payload) VALUES (1, 'x', '\"old\"')",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }

    let affected = update_row_impl(
        &pool,
        "ozendb_it_types",
        "t",
        &[
            ColumnValue { column: String::from("tag"), value: serde_json::json!("xyzuvw") },
            ColumnValue { column: String::from("payload"), value: serde_json::json!("hi") },
        ],
        &[ColumnValue { column: String::from("id"), value: serde_json::json!(1) }],
    )
    .await
    .unwrap();
    assert_eq!(affected, 1);

    let verify = run_query_impl(&pool, "SELECT tag, payload FROM ozendb_it_types.t WHERE id = 1", false)
        .await
        .unwrap();
    // CHAR(10) space-pads short values, so trim before comparing the content.
    assert_eq!(verify.rows[0][0].as_str().unwrap().trim_end(), "xyzuvw");
    assert_eq!(verify.rows[0][1], serde_json::json!("hi"));

    sqlx::query("DROP SCHEMA ozendb_it_types CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn primary_key_detection_is_not_confused_by_a_same_named_constraint_on_another_table() {
    // Regression: the old information_schema-based lookup joined
    // `key_column_usage` to `table_constraints` on constraint name + schema, but
    // constraint names are only unique *per table* — so a foreign key on table
    // `b` named `a_pkey` (the auto-generated name of table `a`'s real primary
    // key) contributed `b`'s column to `a`'s reported primary key.
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;

    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_pk CASCADE",
        "CREATE SCHEMA ozendb_it_pk",
        "CREATE TABLE ozendb_it_pk.a (id INT PRIMARY KEY)", // auto-names the constraint a_pkey
        "CREATE TABLE ozendb_it_pk.b (ref_id INT)",
        "ALTER TABLE ozendb_it_pk.b ADD CONSTRAINT a_pkey FOREIGN KEY (ref_id) REFERENCES ozendb_it_pk.a (id)",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }

    let columns = list_columns_impl(&pool, "ozendb_it_pk", "a").await.unwrap();
    let pk_columns: Vec<&str> = columns.iter().filter(|c| c.is_primary_key).map(|c| c.name.as_str()).collect();
    assert_eq!(pk_columns, vec!["id"], "table b's FK column must not appear in a's primary key");

    sqlx::query("DROP SCHEMA ozendb_it_pk CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn browse_defaults_to_ordering_by_the_primary_key() {
    // Without an explicit order_by, LIMIT/OFFSET alone promises nothing about
    // which rows land on which page. Confirms the fallback actually orders by
    // the primary key rather than leaving the result order up to Postgres.
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;

    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_order CASCADE",
        "CREATE SCHEMA ozendb_it_order",
        "CREATE TABLE ozendb_it_order.t (id INT PRIMARY KEY)",
        "INSERT INTO ozendb_it_order.t VALUES (3), (1), (2)",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }

    let page = browse_table_impl(&pool, "ozendb_it_order", "t", None, false, 10, 0).await.unwrap();
    let ids: Vec<i64> = page.rows.iter().map(|row| row[0].as_i64().unwrap()).collect();
    assert_eq!(ids, vec![1, 2, 3]);

    sqlx::query("DROP SCHEMA ozendb_it_order CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn descending_order_applies_to_every_column_of_a_composite_key() {
    // Regression: `ORDER BY "a", "b" DESC` (the direction appended once, at the
    // end) is `a ASC, b DESC` in SQL, not "both descending" — confirmed live,
    // returning (1,2),(1,1),(2,2),(2,1) instead of (2,2),(2,1),(1,2),(1,1).
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;

    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_composite CASCADE",
        "CREATE SCHEMA ozendb_it_composite",
        "CREATE TABLE ozendb_it_composite.t (a INT, b INT, PRIMARY KEY (a, b))",
        "INSERT INTO ozendb_it_composite.t VALUES (1, 1), (1, 2), (2, 1), (2, 2)",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }

    let page = browse_table_impl(&pool, "ozendb_it_composite", "t", None, true, 10, 0).await.unwrap();
    let pairs: Vec<(i64, i64)> =
        page.rows.iter().map(|row| (row[0].as_i64().unwrap(), row[1].as_i64().unwrap())).collect();
    assert_eq!(pairs, vec![(2, 2), (2, 1), (1, 2), (1, 1)]);

    sqlx::query("DROP SCHEMA ozendb_it_composite CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn a_read_only_connection_is_enforced_per_transaction_not_just_by_session_default() {
    // Two regressions here, both against `nextval()` — a volatile function usable
    // inside a SELECT, so wrapping arbitrary SQL in a subquery (which stops
    // statements that can't live in a FROM clause) never touches it:
    //
    // 1. `run_query_impl(.., read_only: false)` on a `read_only` connection used
    //    to be the *only* enforcement, and there wasn't one — `run_pg_query`
    //    always called it that way regardless of the connection's own flag.
    // 2. Even with the session-level `default_transaction_read_only=on` default
    //    (`pg_uri::options_for`) and `read_only: true` passed through, a query
    //    can flip that *default* off for the rest of the session with
    //    `set_config('default_transaction_read_only', 'off', false)` — confirmed
    //    live, and the change persisted to later queries on the same pooled
    //    connection. `run_wrapped_read_only`'s explicit per-transaction `SET
    //    TRANSACTION READ ONLY` can't be undone that way, and runs fresh on
    //    every call, so this closes both.
    let mut config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };

    // Create the sequence on a normal (writable) connection first.
    let setup_pool = pool(&config).await;
    for stmt in ["DROP SEQUENCE IF EXISTS ozendb_it_seq", "CREATE SEQUENCE ozendb_it_seq"] {
        sqlx::query(stmt).execute(&setup_pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }

    config.read_only = true;
    let read_only_pool = pool(&config).await;

    // A server-rejected statement classifies as "command" (see postgres_code),
    // not "postgres" — the point of these assertions is that it's rejected at all.
    let err = run_query_impl(&read_only_pool, "SELECT nextval('ozendb_it_seq')", true).await.unwrap_err();
    assert_eq!(err.code(), "command", "the server itself must refuse the write");

    // The set_config bypass: even after this runs (successfully — it's a config
    // change, not a write Postgres itself objects to), the *next* call must still
    // be refused, because it starts its own fresh read-only transaction rather
    // than trusting whatever the session default now says.
    let _ = run_query_impl(
        &read_only_pool,
        "SELECT set_config('default_transaction_read_only', 'off', false)",
        true,
    )
    .await
    .unwrap();
    let err = run_query_impl(&read_only_pool, "SELECT nextval('ozendb_it_seq')", true).await.unwrap_err();
    assert_eq!(err.code(), "command", "a prior set_config must not leave a later call writable");

    sqlx::query("DROP SEQUENCE ozendb_it_seq").execute(&setup_pool).await.unwrap();
}
