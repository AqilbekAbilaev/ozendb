//! Live tests of the MySQL table tab's page and count, against the server `mysql.rs` describes.

use super::mysql::{connect, password, run, test_config, SKIP};
use crate::commands::sql::{ColumnFilter, FilterOp};
use crate::commands::{mysql_browse, mysql_count};
use crate::mysql::uri::build_options;
use serde_json::{json, Value};
use sqlx::MySqlPool;

const TABLE: &str = "every `type` ü";

fn quoted(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

/// A database of its own per test, holding one table with a column of each common type
/// and three rows, and a pool with no default database. The caller drops it.
async fn seeded(config: &crate::storage::ConnectionConfig, name: &str) -> MySqlPool {
    let (database, table) = (quoted(name), quoted(TABLE));
    let mut admin = connect(config, "").await;
    for statement in [
        format!("DROP DATABASE IF EXISTS {database}"),
        format!("CREATE DATABASE {database}"),
        format!(
            "CREATE TABLE {database}.{table} (`id key` BIGINT UNSIGNED PRIMARY KEY, small TINYINT, flag TINYINT(1), \
             amount DECIMAL(30,10), ratio FLOAT, big DOUBLE, `name ``x``` VARCHAR(40) COLLATE utf8mb4_bin, note TEXT, \
             day DATE, at DATETIME(6), stamp TIMESTAMP NULL, span TIME, yr YEAR, status ENUM('new','paid'), \
             tags SET('a','b'), doc JSON, raw VARBINARY(4), bits BIT(3), spot POINT)"
        ),
        format!(
            "INSERT INTO {database}.{table} VALUES \
             (18446744073709551615, -128, 1, 12345678901234567890.0123456789, 0.1, -1.5e300, 'Straße', 'long note', \
              '2024-02-29', '2024-02-29 13:14:15.123456', '2024-01-01 00:00:00', '-838:59:59', 2024, 'paid', 'a,b', \
              '{{\"a\": [1, \"b\"]}}', 0x00FF, b'101', ST_GeomFromText('POINT(1 2)')), \
             (2, 5, 0, 1.5, NULL, 2, 'abc', NULL, NULL, NULL, NULL, '25:00:00', NULL, 'new', '', 'null', NULL, NULL, NULL), \
             (9007199254740993, NULL, NULL, NULL, NULL, NULL, 'ABD_%', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)"
        ),
    ] {
        run(&mut admin, &statement).await;
    }
    MySqlPool::connect_with(build_options(config, password().as_deref(), "", None).unwrap()).await.unwrap()
}

async fn drop_seeded(config: &crate::storage::ConnectionConfig, pool: MySqlPool, name: &str) {
    pool.close().await;
    let mut admin = connect(config, "").await;
    run(&mut admin, &format!("DROP DATABASE {}", quoted(name))).await;
}

fn filter(column: &str, op: FilterOp, value: Option<&str>) -> ColumnFilter {
    ColumnFilter { table: 0, column: column.to_string(), op, value: value.map(str::to_string) }
}

/// The primary keys `filters` keep, in key order.
async fn keys(pool: &MySqlPool, name: &str, filters: &[ColumnFilter]) -> Vec<Value> {
    let page = mysql_browse(pool, name, TABLE, filters, None, false, 10, 0).await.unwrap();
    page.rows.into_iter().map(|row| row[0].clone()).collect()
}

#[tokio::test]
async fn every_common_type_reads_as_the_grid_shows_it() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it browse ведомость types";
    let pool = seeded(&config, name).await;
    let page = mysql_browse(&pool, name, TABLE, &[], None, true, 1, 0).await.unwrap();
    assert_eq!(page.columns[0], "id key");
    assert_eq!(page.columns[6], "name `x`");
    assert_eq!(
        page.rows,
        vec![vec![
            json!("18446744073709551615"), json!(-128), json!(1), json!("12345678901234567890.0123456789"), json!(0.1),
            json!(-1.5e300), json!("Straße"), json!("long note"), json!("2024-02-29"), json!("2024-02-29 13:14:15.123456"),
            json!("2024-01-01 00:00:00"), json!("-838:59:59"), json!(2024), json!("paid"), json!("a,b"),
            json!({ "a": [1, "b"] }), json!("0x00FF"), json!("0x05"),
            json!("0x000000000101000000000000000000F03F0000000000000040"),
        ]],
    );
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn pages_follow_the_primary_key_or_the_chosen_column() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it browse ведомость paging";
    let pool = seeded(&config, name).await;
    let page = |order: Option<&'static str>, descending, offset| {
        let pool = pool.clone();
        async move {
            let page = mysql_browse(&pool, name, TABLE, &[], order, descending, 2, offset).await.unwrap();
            page.rows.into_iter().map(|row| row[0].clone()).collect::<Vec<_>>()
        }
    };
    assert_eq!(page(None, false, 0).await, [json!(2), json!("9007199254740993")]);
    assert_eq!(page(None, false, 2).await, [json!("18446744073709551615")]);
    // A binary collation sorts by byte: lower case after upper.
    assert_eq!(page(Some("name `x`"), true, 0).await, [json!(2), json!("18446744073709551615")]);
    let empty = mysql_browse(&pool, name, TABLE, &[filter("small", FilterOp::Gt, Some("100"))], None, false, 2, 0).await.unwrap();
    assert_eq!(empty.columns.len(), 19);
    assert!(empty.rows.is_empty());
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn each_filter_keeps_the_rows_it_names_and_the_count_agrees() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it browse ведомость filters";
    let pool = seeded(&config, name).await;
    let (low, big, max) = (json!(2), json!("9007199254740993"), json!("18446744073709551615"));
    let cases = [
        (filter("id key", FilterOp::Eq, Some("9007199254740993")), vec![big.clone()]),
        (filter("id key", FilterOp::Ne, Some("2")), vec![big.clone(), max.clone()]),
        (filter("amount", FilterOp::Gt, Some("1.5")), vec![max.clone()]),
        (filter("amount", FilterOp::Gte, Some("1.5")), vec![low.clone(), max.clone()]),
        (filter("small", FilterOp::Lt, Some("0")), vec![max.clone()]),
        (filter("day", FilterOp::Lte, Some("2024-03-01")), vec![max.clone()]),
        (filter("name `x`", FilterOp::Contains, Some("STRA")), vec![max.clone()]),
        (filter("name `x`", FilterOp::Contains, Some("_%")), vec![big.clone()]),
        (filter("name `x`", FilterOp::StartsWith, Some("ab")), vec![low.clone(), big.clone()]),
        (filter("ratio", FilterOp::Contains, Some("0.1")), vec![max.clone()]),
        (filter("status", FilterOp::In, Some("new, paid")), vec![low.clone(), max.clone()]),
        (filter("note", FilterOp::IsNull, None), vec![low.clone(), big.clone()]),
        (filter("note", FilterOp::NotNull, None), vec![max.clone()]),
    ];
    for (f, expected) in cases {
        let label = format!("{f:?}");
        let filters = [f];
        assert_eq!(keys(&pool, name, &filters).await, expected, "{label}");
        assert_eq!(mysql_count(&pool, name, TABLE, &filters).await.unwrap(), expected.len() as i64, "{label}");
    }
    assert_eq!(mysql_count(&pool, name, TABLE, &[]).await.unwrap(), 3);
    drop_seeded(&config, pool, name).await;
}
