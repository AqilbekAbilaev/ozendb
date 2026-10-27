//! Live-PostgreSQL coverage of filtered table browsing (`browse_table_impl` /
//! `count_table_impl` with filters). Shares `pg.rs`'s helpers
//! and skip behaviour; see its module doc comment for how to run these.

use crate::commands::sql::{ColumnFilter, ColumnRef, FilterOp, JoinKind, JoinOn, TableJoin};
use crate::commands::{
    browse_table_impl, count_table_impl, list_columns_impl, list_foreign_keys_impl, list_tables_impl, undo_row_edit_impl, update_row_impl, ColumnValue,
};
use crate::postgres::row_history::{PgColumnChange, PgHistoryEntry};
use super::pg::{pool, test_config};

fn by(column: &str) -> ColumnRef {
    ColumnRef { table: 0, column: column.to_string() }
}

fn filter(column: &str, op: FilterOp, value: Option<&str>) -> ColumnFilter {
    ColumnFilter { table: 0, column: column.to_string(), op, value: value.map(str::to_string) }
}

#[tokio::test]
async fn filters_narrow_both_the_page_and_the_count() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_filter CASCADE",
        "CREATE SCHEMA ozendb_it_filter",
        "CREATE TABLE ozendb_it_filter.t (id INT PRIMARY KEY, name TEXT, qty INT, at TIMESTAMPTZ)",
        "INSERT INTO ozendb_it_filter.t VALUES
            (1, 'Apple', 5, '2026-09-01T10:00:00Z'),
            (2, '50% off', 20, '2026-08-15T10:00:00Z'),
            (3, '50 off', 100, NULL),
            (4, NULL, 9, '2026-09-20T10:00:00Z')",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }
    let ids = |filters: Vec<ColumnFilter>| {
        let pool = pool.clone();
        async move {
            let page = browse_table_impl(&pool, "ozendb_it_filter", "t", &[], &filters, Some(&by("id")), false, 100, 0)
                .await
                .unwrap();
            let count = count_table_impl(&pool, "ozendb_it_filter", "t", &[], &filters).await.unwrap();
            let ids: Vec<i64> = page.rows.iter().map(|r| r[0].as_i64().unwrap()).collect();
            assert_eq!(count, ids.len() as i64, "the count must agree with the filtered rows");
            ids
        }
    };

    // Compared as numbers, not text: '9' > '10' as text, but not here.
    assert_eq!(ids(vec![filter("qty", FilterOp::Gt, Some("10"))]).await, vec![2, 3]);
    // Case-insensitive, and a typed `%` is a literal percent sign, not a wildcard.
    assert_eq!(ids(vec![filter("name", FilterOp::Contains, Some("APP"))]).await, vec![1]);
    assert_eq!(ids(vec![filter("name", FilterOp::Contains, Some("50%"))]).await, vec![2]);
    // A timestamp matches on its text form, so a month prefix finds that month.
    assert_eq!(ids(vec![filter("at", FilterOp::Contains, Some("2026-09"))]).await, vec![1, 4]);
    assert_eq!(ids(vec![filter("name", FilterOp::IsNull, None)]).await, vec![4]);
    // Several filters must all hold.
    assert_eq!(
        ids(vec![filter("qty", FilterOp::Lte, Some("20")), filter("at", FilterOp::NotNull, None)]).await,
        vec![1, 2, 4],
    );

    // A value the column's type can't parse is Postgres's own error, not a crash.
    let bad = [filter("qty", FilterOp::Eq, Some("abc"))];
    assert!(browse_table_impl(&pool, "ozendb_it_filter", "t", &[], &bad, None, false, 100, 0).await.is_err());

    sqlx::query("DROP SCHEMA ozendb_it_filter CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn lists_foreign_keys_in_both_directions_with_every_column() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_fk CASCADE",
        "DROP SCHEMA IF EXISTS ozendb_it_fk_other CASCADE",
        "CREATE SCHEMA ozendb_it_fk",
        "CREATE SCHEMA ozendb_it_fk_other",
        "CREATE TABLE ozendb_it_fk.regions (id INT PRIMARY KEY, name TEXT)",
        "CREATE TABLE ozendb_it_fk.merchants (id INT PRIMARY KEY, region_id INT REFERENCES ozendb_it_fk.regions (id))",
        "CREATE TABLE ozendb_it_fk_other.payments (id INT PRIMARY KEY, merchant_id INT REFERENCES ozendb_it_fk.merchants (id))",
        "CREATE TABLE ozendb_it_fk.pairs (a INT, b INT, PRIMARY KEY (a, b))",
        "CREATE TABLE ozendb_it_fk.pair_refs (a INT, b INT, FOREIGN KEY (a, b) REFERENCES ozendb_it_fk.pairs (a, b))",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }

    let keys = list_foreign_keys_impl(&pool, "ozendb_it_fk", "merchants").await.unwrap();
    let described: Vec<String> = keys
        .iter()
        .map(|k| format!("{}.{}.{:?} -> {}.{}.{:?}", k.from_schema, k.from_table, k.from_columns, k.to_schema, k.to_table, k.to_columns))
        .collect();
    assert_eq!(
        described,
        vec![
            r#"ozendb_it_fk.merchants.["region_id"] -> ozendb_it_fk.regions.["id"]"#,
            r#"ozendb_it_fk_other.payments.["merchant_id"] -> ozendb_it_fk.merchants.["id"]"#,
        ]
    );
    // A key over several columns lists them paired, in the key's order.
    let pairs = list_foreign_keys_impl(&pool, "ozendb_it_fk", "pairs").await.unwrap();
    assert_eq!(pairs.len(), 1);
    assert_eq!((pairs[0].from_columns.clone(), pairs[0].to_columns.clone()), (vec!["a".to_string(), "b".to_string()], vec!["a".to_string(), "b".to_string()]));

    for stmt in ["DROP SCHEMA ozendb_it_fk_other CASCADE", "DROP SCHEMA ozendb_it_fk CASCADE"] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }
}

#[tokio::test]
async fn joins_add_related_columns_and_filter_sort_and_count_across_them() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_join CASCADE",
        "CREATE SCHEMA ozendb_it_join",
        "CREATE TABLE ozendb_it_join.regions (id INT PRIMARY KEY, name TEXT)",
        "CREATE TABLE ozendb_it_join.merchants (id INT PRIMARY KEY, name TEXT, region_id INT, parent_id INT)",
        "INSERT INTO ozendb_it_join.regions VALUES (1, 'North'), (2, 'South')",
        "INSERT INTO ozendb_it_join.merchants VALUES (1, 'A', 1, NULL), (2, 'B', 2, 1), (3, 'C', NULL, 1)",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }
    let regions = |kind| TableJoin {
        schema: String::from("ozendb_it_join"),
        table: String::from("regions"),
        kind,
        on: vec![JoinOn { column: String::from("id"), equals: by("region_id") }],
    };
    let browse = |joins: Vec<TableJoin>, filters: Vec<ColumnFilter>, order: ColumnRef, desc: bool| {
        let pool = pool.clone();
        async move {
            let page = browse_table_impl(&pool, "ozendb_it_join", "merchants", &joins, &filters, Some(&order), desc, 100, 0)
                .await
                .unwrap();
            let count = count_table_impl(&pool, "ozendb_it_join", "merchants", &joins, &filters).await.unwrap();
            assert_eq!(count, page.rows.len() as i64, "the count must agree with the joined rows");
            page
        }
    };

    // Each table's columns in order; both `id` and `name` columns kept apart.
    let page = browse(vec![regions(JoinKind::Left)], vec![], by("id"), false).await;
    assert_eq!(page.columns, vec!["id", "name", "region_id", "parent_id", "id", "name"]);
    let names: Vec<_> = page.rows.iter().map(|r| (r[1].clone(), r[5].clone())).collect();
    assert_eq!(names, vec![
        (serde_json::json!("A"), serde_json::json!("North")),
        (serde_json::json!("B"), serde_json::json!("South")),
        (serde_json::json!("C"), serde_json::Value::Null),
    ]);

    // An inner join drops the merchant with no region.
    assert_eq!(browse(vec![regions(JoinKind::Inner)], vec![], by("id"), false).await.rows.len(), 2);

    // Filter and sort on the joined table's columns.
    let south = ColumnFilter { table: 1, ..filter("name", FilterOp::Contains, Some("sou")) };
    let page = browse(vec![regions(JoinKind::Left)], vec![south], by("id"), false).await;
    assert_eq!(page.rows.iter().map(|r| r[0].as_i64().unwrap()).collect::<Vec<_>>(), vec![2]);
    let page = browse(vec![regions(JoinKind::Inner)], vec![], ColumnRef { table: 1, column: String::from("name") }, true).await;
    assert_eq!(page.rows[0][5], serde_json::json!("South"));

    // A table joined to itself: each merchant with its parent.
    let parents = TableJoin {
        schema: String::from("ozendb_it_join"),
        table: String::from("merchants"),
        kind: JoinKind::Inner,
        on: vec![JoinOn { column: String::from("id"), equals: by("parent_id") }],
    };
    let page = browse(vec![parents], vec![], by("id"), false).await;
    let pairs: Vec<_> = page.rows.iter().map(|r| (r[1].clone(), r[5].clone())).collect();
    assert_eq!(pairs, vec![(serde_json::json!("B"), serde_json::json!("A")), (serde_json::json!("C"), serde_json::json!("A"))]);

    sqlx::query("DROP SCHEMA ozendb_it_join CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn pages_a_tied_sort_over_a_one_to_many_join_without_repeating_or_skipping_rows() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS \"ozendb_it ties\" CASCADE",
        "CREATE SCHEMA \"ozendb_it ties\"",
        "CREATE TABLE \"ozendb_it ties\".\"клиенты\" (id INT PRIMARY KEY, tier TEXT)",
        "CREATE TABLE \"ozendb_it ties\".\"order lines\" (id INT PRIMARY KEY, client_id INT, sku TEXT)",
        "INSERT INTO \"ozendb_it ties\".\"клиенты\" SELECT g, 'gold' FROM generate_series(1, 6) g",
        "INSERT INTO \"ozendb_it ties\".\"order lines\" SELECT g, 1 + g % 6, 'same' FROM generate_series(1, 30) g",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }
    let lines = [TableJoin {
        schema: String::from("ozendb_it ties"),
        table: String::from("order lines"),
        kind: JoinKind::Inner,
        on: vec![JoinOn { column: String::from("client_id"), equals: by("id") }],
    }];
    // Every row ties on both the chosen column and the browsed table's key.
    for order in [Some(by("tier")), Some(ColumnRef { table: 1, column: String::from("sku") }), None] {
        let mut seen = Vec::new();
        for offset in 0..30 {
            let page = browse_table_impl(&pool, "ozendb_it ties", "клиенты", &lines, &[], order.as_ref(), true, 1, offset).await.unwrap();
            seen.push(page.rows[0][2].as_i64().unwrap());
        }
        seen.sort_unstable();
        assert_eq!(seen, (1..=30).collect::<Vec<_>>(), "ordered by {order:?}");
    }

    sqlx::query("DROP SCHEMA \"ozendb_it ties\" CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn numeric_arrays_and_numeric_domains_keep_their_exact_digits() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let exact = "12345678901234567890.123456789";
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_numeric CASCADE",
        "CREATE SCHEMA ozendb_it_numeric",
        "CREATE DOMAIN ozendb_it_numeric.money_amount AS numeric(40, 9)",
        "CREATE TABLE ozendb_it_numeric.t (id INT PRIMARY KEY, n numeric, na numeric[], d ozendb_it_numeric.money_amount)",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }
    let insert = format!("INSERT INTO ozendb_it_numeric.t VALUES (1, {exact}, ARRAY[{exact}, 1.5], {exact})");
    sqlx::query(sqlx::AssertSqlSafe(insert)).execute(&pool).await.unwrap();

    let page = browse_table_impl(&pool, "ozendb_it_numeric", "t", &[], &[], None, false, 10, 0).await.unwrap();
    let row = &page.rows[0];
    assert_eq!(row[1], serde_json::json!(exact));
    assert_eq!(row[2], serde_json::json!([exact, "1.5"]));
    assert_eq!(row[3], serde_json::json!("12345678901234567890.123456789"));

    sqlx::query("DROP SCHEMA ozendb_it_numeric CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn edits_array_cells_and_sets_cells_to_null() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_arrays CASCADE",
        "CREATE SCHEMA ozendb_it_arrays",
        "CREATE TABLE ozendb_it_arrays.t (id INT PRIMARY KEY, tags text[], grid int[][], note text)",
        "INSERT INTO ozendb_it_arrays.t VALUES (1, NULL, NULL, 'hi')",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }
    let set = |column: &str, value: serde_json::Value| vec![ColumnValue { column: column.to_string(), value }];
    let key = || vec![ColumnValue { column: String::from("id"), value: serde_json::json!(1) }];

    let tricky = serde_json::json!(["a b", "c\"d", "{x,y}", "NULL", null]);
    assert_eq!(update_row_impl(&pool, "ozendb_it_arrays", "t", &set("tags", tricky.clone()), &key()).await.unwrap(), 1);
    assert_eq!(update_row_impl(&pool, "ozendb_it_arrays", "t", &set("grid", serde_json::json!([[1, 2], [3, 4]])), &key()).await.unwrap(), 1);
    assert_eq!(update_row_impl(&pool, "ozendb_it_arrays", "t", &set("note", serde_json::Value::Null), &key()).await.unwrap(), 1);

    let page = browse_table_impl(&pool, "ozendb_it_arrays", "t", &[], &[], None, false, 10, 0).await.unwrap();
    assert_eq!(page.rows[0][1], tricky, "every element comes back exactly, the string \"NULL\" included");
    assert_eq!(page.rows[0][2], serde_json::json!([[1, 2], [3, 4]]));
    assert_eq!(page.rows[0][3], serde_json::Value::Null);

    sqlx::query("DROP SCHEMA ozendb_it_arrays CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn lists_tables_with_the_planner_row_estimate_when_there_is_one() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_estimate CASCADE",
        "CREATE SCHEMA ozendb_it_estimate",
        "CREATE TABLE ozendb_it_estimate.analysed (id INT)",
        "INSERT INTO ozendb_it_estimate.analysed SELECT generate_series(1, 1000)",
        "ANALYZE ozendb_it_estimate.analysed",
        "CREATE TABLE ozendb_it_estimate.fresh (id INT)",
        "CREATE VIEW ozendb_it_estimate.v AS SELECT 1 AS x",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }
    let tables = list_tables_impl(&pool, "ozendb_it_estimate").await.unwrap();
    let estimate = |name: &str| tables.iter().find(|t| t.name == name).unwrap().estimated_rows;
    assert_eq!(estimate("analysed"), Some(1000));
    assert_eq!(estimate("fresh"), None, "never analysed: no estimate rather than -1");
    assert_eq!(estimate("v"), None, "a view has no rows of its own");

    sqlx::query("DROP SCHEMA ozendb_it_estimate CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn starts_with_and_any_of_work_on_real_column_types() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_ops CASCADE",
        "CREATE SCHEMA ozendb_it_ops",
        "CREATE TYPE ozendb_it_ops.status AS ENUM ('active', 'blocked', 'closed')",
        "CREATE TABLE ozendb_it_ops.t (id INT PRIMARY KEY, name TEXT, mcc SMALLINT, status ozendb_it_ops.status)",
        "INSERT INTO ozendb_it_ops.t VALUES (1, 'EVOS', 5411, 'active'), (2, 'evos 2', 5812, 'blocked'), (3, 'Korzinka', 5411, 'closed'), (4, '5_off', 7011, 'active')",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }
    let ids = |filters: Vec<ColumnFilter>| {
        let pool = pool.clone();
        async move {
            let page = browse_table_impl(&pool, "ozendb_it_ops", "t", &[], &filters, Some(&by("id")), false, 100, 0).await.unwrap();
            let count = count_table_impl(&pool, "ozendb_it_ops", "t", &[], &filters).await.unwrap();
            let ids: Vec<i64> = page.rows.iter().map(|r| r[0].as_i64().unwrap()).collect();
            assert_eq!(count, ids.len() as i64);
            ids
        }
    };

    assert_eq!(ids(vec![filter("name", FilterOp::StartsWith, Some("evos"))]).await, vec![1, 2]);
    assert_eq!(ids(vec![filter("name", FilterOp::StartsWith, Some("5_"))]).await, vec![4]);
    assert_eq!(ids(vec![filter("mcc", FilterOp::StartsWith, Some("54"))]).await, vec![1, 3]);
    assert_eq!(ids(vec![filter("mcc", FilterOp::In, Some("5812, 7011"))]).await, vec![2, 4]);
    assert_eq!(ids(vec![filter("status", FilterOp::In, Some("blocked,closed"))]).await, vec![2, 3]);
    assert_eq!(ids(vec![filter("name", FilterOp::In, Some("EVOS, Korzinka"))]).await, vec![1, 3]);

    // An enum column lists its labels in their declared order; others list none.
    let columns = list_columns_impl(&pool, "ozendb_it_ops", "t").await.unwrap();
    let status = columns.iter().find(|c| c.name == "status").unwrap();
    assert_eq!(status.enum_values, Some(vec!["active".to_string(), "blocked".to_string(), "closed".to_string()]));
    assert_eq!(columns.iter().find(|c| c.name == "mcc").unwrap().enum_values, None);

    sqlx::query("DROP SCHEMA ozendb_it_ops CASCADE").execute(&pool).await.unwrap();
}

/// An edit of one cell in row 1 of `schema`'s table `row t`, as `update_pg_row` records it.
fn undo_entry(schema: &str, column: &str, before: serde_json::Value, after: serde_json::Value) -> PgHistoryEntry {
    PgHistoryEntry {
        id: String::from("e1"),
        conn_id: String::from("pg-it-test"),
        database: String::from("postgres"),
        schema: schema.to_string(),
        table: String::from("row t"),
        at: 0,
        key: vec![ColumnValue { column: String::from("id"), value: serde_json::json!(1) }],
        changes: vec![PgColumnChange { column: column.to_string(), before, after }],
    }
}

#[tokio::test]
async fn undoes_edits_that_set_a_cell_to_null_or_changed_a_json_cell() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        r#"DROP SCHEMA IF EXISTS "ozendb_it undo.ü" CASCADE"#,
        r#"CREATE SCHEMA "ozendb_it undo.ü""#,
        r#"CREATE TABLE "ozendb_it undo.ü"."row t" (id INT PRIMARY KEY, "a note" text, doc json)"#,
        r#"INSERT INTO "ozendb_it undo.ü"."row t" VALUES (1, NULL, '{"b":[1,"x"]}')"#,
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }
    let schema = "ozendb_it undo.ü";

    undo_row_edit_impl(&pool, &undo_entry(schema, "a note", serde_json::json!("hi"), serde_json::Value::Null)).await.unwrap();
    undo_row_edit_impl(&pool, &undo_entry(schema, "doc", serde_json::json!("plain"), serde_json::json!({"b": [1, "x"]}))).await.unwrap();

    let page = browse_table_impl(&pool, schema, "row t", &[], &[], None, false, 10, 0).await.unwrap();
    assert_eq!(page.rows[0][1], serde_json::json!("hi"));
    assert_eq!(page.rows[0][2], serde_json::json!("plain"));

    sqlx::query(r#"DROP SCHEMA "ozendb_it undo.ü" CASCADE"#).execute(&pool).await.unwrap();
}

#[tokio::test]
async fn refuses_to_undo_an_edit_to_null_when_the_cell_changed_since() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_undo_conflict CASCADE",
        "CREATE SCHEMA ozendb_it_undo_conflict",
        r#"CREATE TABLE ozendb_it_undo_conflict."row t" (id INT PRIMARY KEY, "a note" text)"#,
        r#"INSERT INTO ozendb_it_undo_conflict."row t" VALUES (1, 'newer')"#,
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }
    let entry = undo_entry("ozendb_it_undo_conflict", "a note", serde_json::json!("hi"), serde_json::Value::Null);

    assert!(undo_row_edit_impl(&pool, &entry).await.is_err());

    sqlx::query("DROP SCHEMA ozendb_it_undo_conflict CASCADE").execute(&pool).await.unwrap();
}
