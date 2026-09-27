//! Live-PostgreSQL coverage of filtered table browsing (`browse_table_impl` /
//! `count_table_impl` with filters). Shares `pg_integration_tests.rs`'s helpers
//! and skip behaviour; see its module doc comment for how to run these.

use crate::commands::{browse_table_impl, count_table_impl, list_foreign_keys_impl, ColumnFilter, FilterOp};
use crate::pg_integration_tests::{pool, test_config};

fn filter(column: &str, op: FilterOp, value: Option<&str>) -> ColumnFilter {
    ColumnFilter { column: column.to_string(), op, value: value.map(str::to_string) }
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
            let page = browse_table_impl(&pool, "ozendb_it_filter", "t", &filters, Some("id"), false, 100, 0)
                .await
                .unwrap();
            let count = count_table_impl(&pool, "ozendb_it_filter", "t", &filters).await.unwrap();
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
    assert!(browse_table_impl(&pool, "ozendb_it_filter", "t", &bad, None, false, 100, 0).await.is_err());

    sqlx::query("DROP SCHEMA ozendb_it_filter CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn lists_single_column_foreign_keys_in_both_directions() {
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
        .map(|k| format!("{}.{}.{} -> {}.{}.{}", k.from_schema, k.from_table, k.from_column, k.to_schema, k.to_table, k.to_column))
        .collect();
    assert_eq!(
        described,
        vec![
            "ozendb_it_fk.merchants.region_id -> ozendb_it_fk.regions.id",
            "ozendb_it_fk_other.payments.merchant_id -> ozendb_it_fk.merchants.id",
        ]
    );
    // A key over several columns isn't offered.
    assert!(list_foreign_keys_impl(&pool, "ozendb_it_fk", "pairs").await.unwrap().is_empty());

    for stmt in ["DROP SCHEMA ozendb_it_fk_other CASCADE", "DROP SCHEMA ozendb_it_fk CASCADE"] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }
}
