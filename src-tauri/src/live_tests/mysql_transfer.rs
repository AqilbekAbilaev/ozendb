//! Live tests of MySQL export and CSV import (#396), against the server `mysql.rs` describes.

use super::mysql::{connect, password, run, shown_at, test_config, SKIP};
use super::mysql_browse::{pool, quoted};
use crate::commands::sql::transfer::ExportSource;
use crate::commands::{mysql_browse, mysql_export, mysql_import_csv, mysql_import_preview};
use crate::mysql::session::prepare;
use crate::mysql::uri::build_options;
use crate::storage::ConnectionConfig;
use serde_json::{json, Value};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;

const TABLE: &str = "awkward `values` ü";

/// A database of its own per test, holding TABLE: a column of each awkward kind of value.
async fn seeded(config: &ConnectionConfig, name: &str) -> MySqlPool {
    let (database, table) = (quoted(name), quoted(TABLE));
    let mut admin = connect(config, "").await;
    for statement in [
        format!("DROP DATABASE IF EXISTS {database}"),
        format!("CREATE DATABASE {database}"),
        format!(
            "CREATE TABLE {database}.{table} (id INT PRIMARY KEY, note VARCHAR(40), raw VARBINARY(4), bits BIT(3), span TIME, \
             big BIGINT UNSIGNED, doc JSON, amount DECIMAL(30,10), flag TINYINT(1), stamp TIMESTAMP NULL, at DATETIME(3))"
        ),
        format!(
            "INSERT INTO {database}.{table} VALUES \
             (1, NULL, 0x00FF, b'101', '838:59:59', 18446744073709551615, '{{\"a\": [1, \"b\"]}}', \
              12345678901234567890.0123456789, 1, '2024-01-01 00:00:00', '2024-02-29 13:14:15.120'), \
             (2, '', NULL, NULL, '-25:00:00', 0, '\"text\"', -0.5, 0, NULL, NULL), \
             (3, 'Straße, \"quoted\"\\nline two', x'', b'000', NULL, NULL, NULL, NULL, NULL, NULL, NULL)"
        ),
    ] {
        run(&mut admin, &statement).await;
    }
    pool(config).await
}

async fn drop_database(config: &ConnectionConfig, pool: MySqlPool, name: &str) {
    pool.close().await;
    run(&mut connect(config, "").await, &format!("DROP DATABASE {}", quoted(name))).await;
}

fn table(database: &str, table: &str) -> ExportSource {
    ExportSource { schema: Some(database.to_string()), table: Some(table.to_string()), query: None }
}

fn query(sql: &str) -> ExportSource {
    ExportSource { schema: None, table: None, query: Some(sql.to_string()) }
}

async fn rows(pool: &MySqlPool, database: &str, table: &str) -> Vec<Vec<Value>> {
    mysql_browse(pool, database, table, &[], &[], None, false, 100, 0).await.unwrap().rows
}

#[tokio::test]
async fn a_table_exports_to_csv_as_the_grid_shows_it() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it export ведомость csv";
    let pool = seeded(&config, name).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out, ü.csv").to_string_lossy().into_owned();

    let result = mysql_export(&pool, &table(name, TABLE), "csv", &path).await.unwrap();
    let csv = std::fs::read_to_string(&path).unwrap();
    assert_eq!(result.rows, Some(3));
    assert_eq!(result.bytes, csv.len() as u64);
    assert_eq!(
        csv,
        format!(
            "id,note,raw,bits,span,big,doc,amount,flag,stamp,at\n\
             1,,0x00FF,5,838:59:59,18446744073709551615,\"{{\"\"a\"\":[1,\"\"b\"\"]}}\",12345678901234567890.0123456789,1,{},2024-02-29 13:14:15.120\n\
             2,\"\",,,-25:00:00,0,\"\"\"text\"\"\",-0.5000000000,0,,\n\
             3,\"Straße, \"\"quoted\"\"\nline two\",0x,0,,,,,,,\n",
            shown_at("2024-01-01 00:00:00"),
        ),
    );
    drop_database(&config, pool, name).await;
}

#[tokio::test]
async fn json_export_keeps_column_order_and_the_grid_s_values() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it export ведомость json";
    let pool = seeded(&config, name).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out.json").to_string_lossy().into_owned();

    assert_eq!(mysql_export(&pool, &table(name, TABLE), "json", &path).await.unwrap().rows, Some(3));
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(
        text.starts_with(r#"[
  {"id":1,"note":null,"raw":"0x00FF","bits":5,"span":"838:59:59","big":"18446744073709551615","doc":{"a":[1,"b"]},"amount":"12345678901234567890.0123456789","flag":true,"#),
        "{text}"
    );
    let parsed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed[1]["note"], json!(""));
    assert_eq!(parsed[1]["doc"], json!("text"));
    assert_eq!(parsed[2]["note"], json!("Straße, \"quoted\"\nline two"));
    drop_database(&config, pool, name).await;
}

#[tokio::test]
async fn a_query_exports_every_row_past_the_grid_cap_and_a_write_is_refused() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it export ведомость query";
    let pool = seeded(&config, name).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out.json").to_string_lossy().into_owned();
    let digits = (0..10).map(|d| format!("SELECT {d} AS d")).collect::<Vec<_>>().join(" UNION ALL ");
    let many = format!("SELECT a.d * 1000 + b.d * 100 + c.d * 10 + e.d AS n FROM ({digits}) a, ({digits}) b, ({digits}) c, ({digits}) e;");

    assert_eq!(mysql_export(&pool, &query(&many), "json", &path).await.unwrap().rows, Some(10_000));
    let write = query(&format!("DELETE FROM {}.{}", quoted(name), quoted(TABLE)));
    assert!(mysql_export(&pool, &write, "csv", &path).await.is_err());
    assert_eq!(rows(&pool, name, TABLE).await.len(), 3, "the refused export deleted nothing");
    drop_database(&config, pool, name).await;
}

#[tokio::test]
async fn two_columns_of_one_name_export_to_csv_but_not_to_json() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool(&config).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out").to_string_lossy().into_owned();
    let twice = query("SELECT 1 AS a, 2 AS a");

    mysql_export(&pool, &twice, "csv", &path).await.unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "a,a\n1,2\n");
    let refusal = mysql_export(&pool, &twice, "json", &path).await.unwrap_err().user_message();
    assert!(refusal.contains("two columns named a"), "{refusal}");
    pool.close().await;
}

/// The export lifts the five-minute limit on its own session, which is closed after, so
/// the one session the pool may hold still has the limit.
#[tokio::test]
async fn an_export_leaves_no_session_without_the_time_limit() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .after_connect(|connection, _| Box::pin(prepare(connection, false)))
        .connect_with(build_options(&config, password().as_deref(), "", None).unwrap())
        .await
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("out.csv").to_string_lossy().into_owned();

    mysql_export(&pool, &query("SELECT @@SESSION.max_execution_time AS limit_ms"), "csv", &path).await.unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "limit_ms\n0\n");
    let limit: u64 = sqlx::query_scalar("SELECT @@SESSION.max_execution_time").fetch_one(&pool).await.unwrap();
    assert_eq!(limit, 300_000);
    pool.close().await;
}

#[tokio::test]
async fn a_table_exported_to_csv_imports_back_into_an_empty_copy() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it import ведомость round trip";
    let copy = "copy ü";
    let pool = seeded(&config, name).await;
    run(&mut connect(&config, "").await, &format!("CREATE TABLE {0}.{1} LIKE {0}.{2}", quoted(name), quoted(copy), quoted(TABLE))).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("round trip.csv").to_string_lossy().into_owned();
    mysql_export(&pool, &table(name, TABLE), "csv", &path).await.unwrap();

    let preview = mysql_import_preview(&pool, name, copy, &path, 20).await.unwrap();
    assert_eq!(preview.rows.len(), 3);
    assert_eq!(preview.mapping, preview.headers.iter().map(|h| Some(h.clone())).collect::<Vec<_>>());
    assert_eq!(mysql_import_csv(&pool, name, copy, &path, &preview.mapping).await.unwrap(), 3);

    // Every value comes back, except that an empty string imports as NULL, as on PostgreSQL.
    let mut expected = rows(&pool, name, TABLE).await;
    expected[1][1] = Value::Null;
    assert_eq!(rows(&pool, name, copy).await, expected);
    drop_database(&config, pool, name).await;
}

/// A table of `n` and a file of 2,500 rows with blank lines among them, whose 1,700th
/// data row holds a value `n` can't take.
async fn bad_value(config: &ConnectionConfig, name: &str) -> (tempfile::TempDir, String) {
    let mut admin = connect(config, "").await;
    run(&mut admin, &format!("DROP DATABASE IF EXISTS {}", quoted(name))).await;
    run(&mut admin, &format!("CREATE DATABASE {}", quoted(name))).await;
    run(&mut admin, &format!("CREATE TABLE {}.numbers (n INT NOT NULL, label TEXT)", quoted(name))).await;
    let lines: Vec<String> = (1..=2500).map(|i| if i == 1700 { String::from("abc,bad\n\n") } else { format!("{i},ü {i}\n") }).collect();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("numbers.csv").to_string_lossy().into_owned();
    std::fs::write(&path, format!("n,label\n\n{}", lines.concat())).unwrap();
    (dir, path)
}

async fn count(pool: &MySqlPool, name: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {}.numbers", quoted(name)))).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn a_bad_value_names_its_row_in_the_file_and_imports_nothing() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it import ведомость bad value";
    let pool = pool(&config).await;
    let (_dir, path) = bad_value(&config, name).await;

    let mapping = [Some(String::from("n")), Some(String::from("label"))];
    let refusal = mysql_import_csv(&pool, name, "numbers", &path, &mapping).await.unwrap_err().user_message();
    assert!(refusal.starts_with("Row 1700: Incorrect integer value: 'abc' for column"), "{refusal}");
    assert!(refusal.ends_with(". Nothing was imported."), "{refusal}");
    assert_eq!(count(&pool, name).await, 0);
    drop_database(&config, pool, name).await;
}

/// A server or login whose own mode isn't strict would store 'abc' as 0 with a warning;
/// import turns strict mode on for its session all the same.
#[tokio::test]
async fn a_bad_value_fails_on_a_session_that_is_not_strict() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it import ведомость lax";
    let lax = MySqlPoolOptions::new()
        .after_connect(|connection, _| {
            Box::pin(async move {
                prepare(connection, false).await?;
                sqlx::raw_sql("SET SESSION sql_mode = ''").execute(connection).await.map(drop)
            })
        })
        .connect_with(build_options(&config, password().as_deref(), "", None).unwrap())
        .await
        .unwrap();
    let (_dir, path) = bad_value(&config, name).await;

    let mapping = [Some(String::from("n")), None];
    let refusal = mysql_import_csv(&lax, name, "numbers", &path, &mapping).await.unwrap_err().user_message();
    assert!(refusal.starts_with("Row 1700: "), "{refusal}");
    assert_eq!(count(&lax, name).await, 0);
    let mode: String = sqlx::query_scalar("SELECT @@SESSION.sql_mode").fetch_one(&lax).await.unwrap();
    assert_eq!(mode, "", "the pool's sessions keep their own mode");
    drop_database(&config, lax, name).await;
}

#[tokio::test]
async fn a_table_that_cannot_roll_back_is_refused() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it import ведомость myisam";
    let pool = pool(&config).await;
    let mut admin = connect(&config, "").await;
    run(&mut admin, &format!("DROP DATABASE IF EXISTS {}", quoted(name))).await;
    run(&mut admin, &format!("CREATE DATABASE {}", quoted(name))).await;
    run(&mut admin, &format!("CREATE TABLE {}.numbers (n INT) ENGINE = MyISAM", quoted(name))).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("numbers.csv").to_string_lossy().into_owned();
    std::fs::write(&path, "n\n1\n").unwrap();

    let preview = mysql_import_preview(&pool, name, "numbers", &path, 20).await.unwrap_err().user_message();
    assert!(preview.contains("MyISAM engine, which can't roll back"), "{preview}");
    let import = mysql_import_csv(&pool, name, "numbers", &path, &[Some(String::from("n"))]).await.unwrap_err().user_message();
    assert!(import.contains("MyISAM"), "{import}");
    assert_eq!(count(&pool, name).await, 0);
    drop_database(&config, pool, name).await;
}

/// A thousand rows of 70 KB would make one 70 MB INSERT, past the 64 MB statement a
/// server takes by default; a batch is cut at half the server's limit instead.
#[tokio::test]
async fn rows_too_large_for_one_statement_are_sent_in_smaller_batches() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it import ведомость large";
    let pool = pool(&config).await;
    let mut admin = connect(&config, "").await;
    run(&mut admin, &format!("DROP DATABASE IF EXISTS {}", quoted(name))).await;
    run(&mut admin, &format!("CREATE DATABASE {}", quoted(name))).await;
    run(&mut admin, &format!("CREATE TABLE {}.numbers (n INT NOT NULL, label LONGTEXT)", quoted(name))).await;
    let packet: u64 = sqlx::query_scalar("SELECT @@max_allowed_packet").fetch_one(&pool).await.unwrap();
    let label = "x".repeat(packet as usize / 1000 + 6 * 1024);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("numbers.csv").to_string_lossy().into_owned();
    std::fs::write(&path, format!("n,label\n{}", (1..=1000).map(|i| format!("{i},{label}\n")).collect::<String>())).unwrap();

    let mapping = [Some(String::from("n")), Some(String::from("label"))];
    assert_eq!(mysql_import_csv(&pool, name, "numbers", &path, &mapping).await.unwrap(), 1000);
    assert_eq!(count(&pool, name).await, 1000);
    drop_database(&config, pool, name).await;
}
