//! Live tests of the MySQL table tab's page and count, against the server `mysql.rs` describes.

use super::mysql::{connect, password, run, shown_at, test_config, SKIP};
use crate::commands::sql::{ColumnFilter, ColumnRef, FilterOp};
use crate::commands::{mysql_browse, mysql_count};
use crate::mysql::session::prepare;
use crate::mysql::uri::build_options;
use serde_json::{json, Value};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;

pub(super) const TABLE: &str = "every `type` ü";

pub(super) fn quoted(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

/// A pool with no default database, each session prepared as the app's are.
pub(super) async fn pool(config: &crate::storage::ConnectionConfig) -> MySqlPool {
    MySqlPoolOptions::new()
        .after_connect(|connection, _| Box::pin(prepare(connection, false)))
        .connect_with(build_options(config, password().as_deref(), "", None).unwrap())
        .await
        .unwrap()
}

/// A database of its own per test, holding one table with a column of each common type
/// and three rows, and a pool with no default database. The caller drops it.
pub(super) async fn seeded(config: &crate::storage::ConnectionConfig, name: &str) -> MySqlPool {
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
    pool(config).await
}

pub(super) async fn drop_seeded(config: &crate::storage::ConnectionConfig, pool: MySqlPool, name: &str) {
    pool.close().await;
    let mut admin = connect(config, "").await;
    run(&mut admin, &format!("DROP DATABASE {}", quoted(name))).await;
}

fn filter(column: &str, op: FilterOp, value: Option<&str>) -> ColumnFilter {
    ColumnFilter { table: 0, column: column.to_string(), op, value: value.map(str::to_string) }
}

/// The primary keys `filters` keep, in key order.
async fn keys(pool: &MySqlPool, name: &str, filters: &[ColumnFilter]) -> Vec<Value> {
    let page = mysql_browse(pool, name, TABLE, &[], filters, None, false, 10, 0).await.unwrap();
    page.rows.into_iter().map(|row| row[0].clone()).collect()
}

#[tokio::test]
async fn every_common_type_reads_as_the_grid_shows_it() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it browse ведомость types";
    let pool = seeded(&config, name).await;
    let page = mysql_browse(&pool, name, TABLE, &[], &[], None, true, 1, 0).await.unwrap();
    assert_eq!(page.columns[0], "id key");
    assert_eq!(page.columns[6], "name `x`");
    assert_eq!(
        page.rows,
        vec![vec![
            json!("18446744073709551615"), json!(-128), json!(true), json!("12345678901234567890.0123456789"), json!(0.1),
            json!(-1.5e300), json!("Straße"), json!("long note"), json!("2024-02-29"), json!("2024-02-29 13:14:15.123456"),
            json!(shown_at("2024-01-01 00:00:00")), json!("-838:59:59"), json!(2024), json!("paid"), json!("a,b"),
            json!({ "a": [1, "b"] }), json!("0x00FF"), json!(5),
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
            let order = order.map(|column: &str| ColumnRef { table: 0, column: column.into() });
            let page = mysql_browse(&pool, name, TABLE, &[], &[], order.as_ref(), descending, 2, offset).await.unwrap();
            page.rows.into_iter().map(|row| row[0].clone()).collect::<Vec<_>>()
        }
    };
    assert_eq!(page(None, false, 0).await, [json!(2), json!("9007199254740993")]);
    assert_eq!(page(None, false, 2).await, [json!("18446744073709551615")]);
    // A binary collation sorts by byte: lower case after upper.
    assert_eq!(page(Some("name `x`"), true, 0).await, [json!(2), json!("18446744073709551615")]);
    let empty = mysql_browse(&pool, name, TABLE, &[], &[filter("small", FilterOp::Gt, Some("100"))], None, false, 2, 0).await.unwrap();
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
        assert_eq!(mysql_count(&pool, name, TABLE, &[], &filters).await.unwrap(), expected.len() as i64, "{label}");
    }
    assert_eq!(mysql_count(&pool, name, TABLE, &[], &[]).await.unwrap(), 3);
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn a_timestamp_filters_on_the_text_the_grid_shows() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it browse ведомость stamp";
    let pool = seeded(&config, name).await;
    let page = mysql_browse(&pool, name, TABLE, &[], &[], None, true, 1, 0).await.unwrap();
    let shown = page.rows[0][10].as_str().unwrap().to_string();
    assert_eq!(shown, shown_at("2024-01-01 00:00:00"));
    for op in [FilterOp::Eq, FilterOp::Contains, FilterOp::StartsWith, FilterOp::In] {
        let label = format!("{op:?}");
        assert_eq!(keys(&pool, name, &[filter("stamp", op, Some(&shown))]).await, [json!("18446744073709551615")], "{label}");
    }
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn every_type_reads_exactly_at_its_edges() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it browse ведомость edges";
    let (database, table) = (quoted(name), quoted("edge `cases` ü"));
    let nines = |whole: usize, fraction: usize| format!("{}.{}", "9".repeat(whole), "9".repeat(fraction));
    let mut admin = connect(&config, "").await;
    for statement in [
        format!("DROP DATABASE IF EXISTS {database}"),
        format!("CREATE DATABASE {database}"),
        format!(
            "CREATE TABLE {database}.{table} (id INT PRIMARY KEY, s SMALLINT, m MEDIUMINT, i INT, iu INT UNSIGNED, \
             b BIGINT, bu BIGINT UNSIGNED, flag TINYINT(1), uflag TINYINT(1) UNSIGNED, yes BOOLEAN, bit1 BIT(1), \
             bit64 BIT(64), wide DECIMAL(65,0), fine DECIMAL(65,30), span TIME(6), long_span TIME, day DATE, \
             at DATETIME(6), at3 DATETIME(3), stamp TIMESTAMP(3) NULL, note TEXT COLLATE utf8mb4_bin, raw LONGBLOB, \
             fixed BINARY(3), tags SET('a','b','c'), doc JSON)"
        ),
        // The zero date needs a mode that allows it; the zone shows a TIMESTAMP is read in the user's zone.
        String::from("SET SESSION sql_mode = '', SESSION time_zone = '+05:00'"),
        format!(
            "INSERT INTO {database}.{table} VALUES \
             (1, -300, -8388608, -2147483648, 4294967295, 9007199254740991, 18446744073709551615, -5, 251, TRUE, b'1', \
              0xFFFFFFFFFFFFFFFF, {}, {}, '09:05:00.000001', '838:59:59', '0000-00-00', '2024-01-01 00:00:00', \
              '2024-02-29 13:14:15.5', '2024-06-30 23:59:59.12', 'Ab', 'Ab', 'a', 'a,c', '[1, 2.5, \"x\", null, true]'), \
             (2, NULL, NULL, NULL, NULL, -9223372036854775808, 0, 0, 1, FALSE, b'0', 0, -{0}, -{1}, '00:00:00', \
              '-838:59:59', NULL, '0000-00-00 00:00:00', NULL, '0000-00-00 00:00:00', NULL, NULL, NULL, '', '{{}}'), \
             (3, NULL, NULL, NULL, NULL, 9007199254740992, NULL, 5, NULL, NULL, NULL, NULL, NULL, NULL, '-12:00:00.5', \
              '-00:00:01', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
            "9".repeat(65),
            nines(35, 30),
        ),
    ] {
        run(&mut admin, &statement).await;
    }
    let pool = pool(&config).await;
    let page = mysql_browse(&pool, name, "edge `cases` ü", &[], &[], None, false, 10, 0).await.unwrap();
    let null = Value::Null;
    assert_eq!(
        page.rows[0],
        vec![
            json!(1), json!(-300), json!(-8_388_608), json!(-2_147_483_648i64), json!(4_294_967_295u32),
            json!(9_007_199_254_740_991i64), json!("18446744073709551615"), json!(-5), json!(251), json!(true), json!(1),
            json!("18446744073709551615"), json!("9".repeat(65)), json!(nines(35, 30)), json!("09:05:00.000001"),
            json!("838:59:59"), json!("0000-00-00"), json!("2024-01-01 00:00:00.000000"), json!("2024-02-29 13:14:15.500"),
            json!(shown_at("2024-06-30 18:59:59.120")), json!("Ab"), json!("0x4162"), json!("0x610000"), json!("a,c"),
            json!([1, 2.5, "x", null, true]),
        ],
    );
    assert_eq!(
        page.rows[1],
        vec![
            json!(2), null.clone(), null.clone(), null.clone(), null.clone(), json!("-9223372036854775808"), json!(0),
            json!(false), json!(true), json!(false), json!(0), json!(0), json!(format!("-{}", "9".repeat(65))),
            json!(format!("-{}", nines(35, 30))), json!("00:00:00.000000"), json!("-838:59:59"), null.clone(),
            json!("0000-00-00 00:00:00.000000"), null.clone(), json!("0000-00-00 00:00:00.000"), null.clone(), null.clone(),
            null.clone(), json!(""), json!({}),
        ],
    );
    assert_eq!(
        page.rows[2],
        [
            vec![json!(3), null.clone(), null.clone(), null.clone(), null.clone(), json!("9007199254740992"), null.clone(), json!(5)],
            vec![null.clone(); 6],
            vec![json!("-12:00:00.500000"), json!("-00:00:01")],
            vec![null; 9],
        ]
        .concat(),
    );
    pool.close().await;
    run(&mut admin, &format!("DROP DATABASE {database}")).await;
}

#[tokio::test]
async fn filters_compare_booleans_bits_and_decimals_exactly_at_their_edges() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it browse ведомость exact filters";
    let (database, table) = (quoted(name), quoted("exact `filters` ü"));
    let (huge, max) = (format!("1{}", "0".repeat(64)), format!("{}.{}", "9".repeat(35), "9".repeat(30)));
    let tiny = format!("0.{}1", "0".repeat(29));
    let mut admin = connect(&config, "").await;
    for statement in [
        format!("DROP DATABASE IF EXISTS {database}"),
        format!("CREATE DATABASE {database}"),
        format!(
            "CREATE TABLE {database}.{table} (id INT PRIMARY KEY, flag TINYINT(1), bits BIT(64), wide DECIMAL(65,0), \
             fine DECIMAL(65,30), cents DECIMAL(10,2), day DATE)"
        ),
        String::from("SET SESSION sql_mode = ''"),
        format!(
            "INSERT INTO {database}.{table} VALUES \
             (1, 1, 0xFFFFFFFFFFFFFFFF, {huge}, {tiny}, 1.51, '0000-00-00'), \
             (2, 0, 5, {huge} + 1, {max}, 1.50, '2024-01-01'), \
             (3, 5, 0, -1, -{max}, NULL, NULL)"
        ),
    ] {
        run(&mut admin, &statement).await;
    }
    let pool = pool(&config).await;
    let one_more = format!("1{}1", "0".repeat(63));
    let cases = [
        (filter("flag", FilterOp::Eq, Some("true")), vec![1]),
        (filter("flag", FilterOp::Eq, Some("FALSE")), vec![2]),
        (filter("flag", FilterOp::Eq, Some("5")), vec![3]),
        (filter("flag", FilterOp::In, Some("true, false")), vec![1, 2]),
        (filter("flag", FilterOp::Ne, Some("true")), vec![2, 3]),
        (filter("bits", FilterOp::Eq, Some("18446744073709551615")), vec![1]),
        (filter("bits", FilterOp::Gt, Some("4")), vec![1, 2]),
        (filter("wide", FilterOp::Eq, Some(&one_more)), vec![2]),
        (filter("wide", FilterOp::Gt, Some(&huge)), vec![2]),
        (filter("wide", FilterOp::Lt, Some("0")), vec![3]),
        (filter("wide", FilterOp::Eq, Some("1e64")), vec![1]),
        (filter("wide", FilterOp::In, Some("1E+64, -1")), vec![1, 3]),
        (filter("fine", FilterOp::Eq, Some(&tiny)), vec![1]),
        (filter("fine", FilterOp::Gte, Some(&max)), vec![2]),
        (filter("fine", FilterOp::Lt, Some("0")), vec![3]),
        (filter("fine", FilterOp::Eq, Some("1e-30")), vec![1]),
        (filter("cents", FilterOp::Gt, Some("1.505")), vec![1]),
        (filter("cents", FilterOp::Lt, Some("1.505")), vec![2]),
        (filter("cents", FilterOp::Eq, Some("1.5")), vec![2]),
        (filter("day", FilterOp::Eq, Some("0000-00-00")), vec![1]),
    ];
    for (f, expected) in cases {
        let label = format!("{f:?}");
        let filters = [f];
        let page = mysql_browse(&pool, name, "exact `filters` ü", &[], &filters, None, false, 10, 0).await.unwrap();
        let ids: Vec<Value> = page.rows.into_iter().map(|row| row[0].clone()).collect();
        assert_eq!(ids, expected.iter().map(|&id| json!(id)).collect::<Vec<_>>(), "{label}");
        assert_eq!(mysql_count(&pool, name, "exact `filters` ü", &[], &filters).await.unwrap(), expected.len() as i64, "{label}");
    }
    pool.close().await;
    run(&mut admin, &format!("DROP DATABASE {database}")).await;
}
