//! Live tests of the MySQL table tab's joins, against the server `mysql.rs` describes.

use super::mysql::{connect, run, shown_at, test_config, SKIP};
use super::mysql_browse::{pool, quoted};
use crate::commands::sql::{ColumnFilter, ColumnRef, FilterOp, JoinKind, JoinOn, TableJoin};
use crate::commands::{mysql_browse, mysql_count};
use serde_json::json;

const ORDERS: &str = "orders `o` ü";

fn on(column: &str, equals: &str) -> JoinOn {
    JoinOn { column: column.into(), equals: ColumnRef { table: 0, column: equals.into() } }
}

fn filter(table: usize, column: &str, op: FilterOp, value: &str) -> ColumnFilter {
    ColumnFilter { table, column: column.into(), op, value: Some(value.into()) }
}

#[tokio::test]
async fn a_page_joins_filters_and_sorts_across_tables_and_databases() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let (name, other) = ("ozendb it join ведомость", "ozendb it join `elsewhere`");
    let (db, elsewhere) = (quoted(name), quoted(other));
    let mut admin = connect(&config, "").await;
    for statement in [
        format!("DROP DATABASE IF EXISTS {db}"),
        format!("DROP DATABASE IF EXISTS {elsewhere}"),
        format!("CREATE DATABASE {db}"),
        format!("CREATE DATABASE {elsewhere}"),
        format!("CREATE TABLE {elsewhere}.`склад` (slot INT, `zone z` INT, label VARCHAR(20), big BIGINT UNSIGNED, PRIMARY KEY (slot, `zone z`))"),
        format!("CREATE TABLE {db}.`buyers, b` (id INT PRIMARY KEY, name VARCHAR(20), vip TINYINT(1), `joined at` TIMESTAMP NULL)"),
        format!(
            "CREATE TABLE {db}.{} (id INT PRIMARY KEY, `buyer id` INT, `at slot` INT, `at zone` INT, \
             FOREIGN KEY (`buyer id`) REFERENCES {db}.`buyers, b` (id), \
             FOREIGN KEY (`at slot`, `at zone`) REFERENCES {elsewhere}.`склад` (slot, `zone z`))",
            quoted(ORDERS)
        ),
        format!("INSERT INTO {elsewhere}.`склад` VALUES (1, 1, 'shelf a', 9007199254740993), (2, 1, 'shelf b', 5)"),
        format!("INSERT INTO {db}.`buyers, b` VALUES (1, 'Ann', 1, '2024-01-01 00:00:00'), (2, 'bob', 0, NULL), (3, 'Cleo', 1, NULL)"),
        format!("INSERT INTO {db}.{} VALUES (10, 1, 1, 1), (11, 3, 1, 1), (12, 2, 1, 1), (13, 1, 2, 1), (14, 3, NULL, NULL)", quoted(ORDERS)),
    ] {
        run(&mut admin, &statement).await;
    }
    let pool = pool(&config).await;
    let joins = [
        TableJoin { schema: name.into(), table: "buyers, b".into(), kind: JoinKind::Inner, on: vec![on("id", "buyer id")] },
        TableJoin { schema: other.into(), table: "склад".into(), kind: JoinKind::Left, on: vec![on("slot", "at slot"), on("zone z", "at zone")] },
    ];
    // Exact comparisons on the joined tables' own types: TINYINT(1)'s true, and a BIGINT past 2^53.
    let filters = [
        filter(1, "vip", FilterOp::Eq, "true"),
        filter(2, "big", FilterOp::Gt, "9007199254740992"),
        filter(2, "label", FilterOp::Contains, "SHELF A"),
    ];
    let by_name = ColumnRef { table: 1, column: "name".into() };
    let page = |limit, offset| mysql_browse(&pool, name, ORDERS, &joins, &filters, Some(&by_name), true, limit, offset);
    let first = page(10, 0).await.unwrap();
    assert_eq!(first.columns.len(), 12);
    assert_eq!(first.rows.iter().map(|row| row[0].clone()).collect::<Vec<_>>(), [json!(11), json!(10)]);
    let second = page(1, 1).await.unwrap();
    assert_eq!(
        second.rows,
        [[json!(10), json!(1), json!(1), json!(1), json!(1), json!("Ann"), json!(true), json!(shown_at("2024-01-01 00:00:00")),
            json!(1), json!(1), json!("shelf a"), json!("9007199254740993")]]
    );
    assert_eq!(mysql_count(&pool, name, ORDERS, &joins, &filters).await.unwrap(), 2);
    // A left join keeps the orders with no shelf; the inner one drops none here.
    assert_eq!(mysql_count(&pool, name, ORDERS, &joins, &[]).await.unwrap(), 5);
    pool.close().await;
    // The orders' database first: its key holds the other's table.
    run(&mut admin, &format!("DROP DATABASE {db}")).await;
    run(&mut admin, &format!("DROP DATABASE {elsewhere}")).await;
}

/// One customer with many orders: ordered by the customer's key alone, MySQL 8.4 sorts
/// the ties differently from one page to the next once there are a couple of dozen.
#[tokio::test]
async fn pages_of_a_one_to_many_join_neither_overlap_nor_skip() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it join ведомость paging";
    let db = quoted(name);
    let orders: Vec<String> = (1..=20).map(|id| format!("({id}, 1)")).collect();
    let mut admin = connect(&config, "").await;
    for statement in [
        format!("DROP DATABASE IF EXISTS {db}"),
        format!("CREATE DATABASE {db}"),
        format!("CREATE TABLE {db}.`customers ü` (id INT PRIMARY KEY)"),
        format!("CREATE TABLE {db}.{} (id INT PRIMARY KEY, `customer id` INT)", quoted(ORDERS)),
        format!("INSERT INTO {db}.`customers ü` VALUES (1), (2)"),
        format!("INSERT INTO {db}.{} VALUES {}", quoted(ORDERS), orders.join(", ")),
    ] {
        run(&mut admin, &statement).await;
    }
    let pool = pool(&config).await;
    let joins = [TableJoin { schema: name.into(), table: ORDERS.into(), kind: JoinKind::Left, on: vec![on("customer id", "id")] }];
    let mut seen = Vec::new();
    for offset in (0..22).step_by(2) {
        let page = mysql_browse(&pool, name, "customers ü", &joins, &[], None, false, 2, offset).await.unwrap();
        seen.extend(page.rows.into_iter().map(|row| (row[0].clone(), row[1].clone())));
    }
    let mut expected: Vec<_> = (1..=20).map(|id| (json!(1), json!(id))).collect();
    expected.push((json!(2), json!(null)));
    assert_eq!(seen, expected);
    pool.close().await;
    run(&mut admin, &format!("DROP DATABASE {db}")).await;
}
