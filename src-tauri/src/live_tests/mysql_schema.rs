//! Live tests of the MySQL sidebar's catalog reads, against the server `mysql.rs` describes.

use super::mysql::{connect, password, run, test_config, SKIP};
use crate::commands::{mysql_columns, mysql_databases, mysql_foreign_keys, mysql_tables, MySqlForeignKey, MySqlReference};
use crate::mysql::uri::build_options;
use sqlx::{Connection, MySqlPool};

/// `name` as a database each test seeds for itself, so tests running at once never share one.
fn database(name: &str) -> String {
    format!("ozendb it `tree` ведомость {name}")
}

fn quoted(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

/// A database with a table, a table keyed to it and a view, all awkwardly named, and a
/// pool with no default database to read the catalog through. The caller drops it.
async fn seeded(config: &crate::storage::ConnectionConfig, name: &str) -> MySqlPool {
    let database = quoted(name);
    let mut admin = connect(config, "").await;
    for statement in [
        format!("DROP DATABASE IF EXISTS {database}"),
        format!("CREATE DATABASE {database}"),
        format!("CREATE TABLE {database}.`клиенты ü` (`id key` INT PRIMARY KEY, email VARCHAR(80) NOT NULL UNIQUE)"),
        format!(
            "CREATE TABLE {database}.`order items` (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, \
             `buyer ``id``` INT NULL, status ENUM('new','it''s \\\\ paid') NOT NULL DEFAULT 'new', \
             FOREIGN KEY (`buyer ``id```) REFERENCES {database}.`клиенты ü` (`id key`))"
        ),
        format!("INSERT INTO {database}.`клиенты ü` VALUES (1, 'a@example.com'), (2, 'b@example.com')"),
        format!("ANALYZE TABLE {database}.`клиенты ü`"),
        format!("CREATE VIEW {database}.`big ``spenders``` AS SELECT email FROM {database}.`клиенты ü`"),
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

#[tokio::test]
async fn databases_are_listed_with_mysql_s_own_flagged_as_system() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = database("databases");
    let pool = seeded(&config, &name).await;
    let databases = mysql_databases(&pool).await.unwrap();
    let system = |name: &str| databases.iter().find(|d| d.name == name).map(|d| d.system);
    assert_eq!(system(&name), Some(false));
    assert_eq!(system("mysql"), Some(true));
    assert_eq!(system("information_schema"), Some(true));
    drop_seeded(&config, pool, &name).await;
}

#[tokio::test]
async fn tables_and_views_come_with_an_estimate_for_tables_only() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = database("tables");
    let pool = seeded(&config, &name).await;
    let tables = mysql_tables(&pool, &name).await.unwrap();
    let listed: Vec<(&str, &str, bool)> =
        tables.iter().map(|t| (t.name.as_str(), t.kind.as_str(), t.estimated_rows.is_some())).collect();
    assert_eq!(
        listed,
        [("big `spenders`", "view", false), ("order items", "table", true), ("клиенты ü", "table", true)],
    );
    drop_seeded(&config, pool, &name).await;
}

#[tokio::test]
async fn columns_carry_their_type_key_default_and_reference() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = database("columns");
    let pool = seeded(&config, &name).await;
    let columns = mysql_columns(&pool, &name, "order items").await.unwrap();
    let listed: Vec<(&str, &str, bool, bool, Option<&str>)> = columns
        .iter()
        .map(|c| (c.name.as_str(), c.data_type.as_str(), c.nullable, c.is_primary_key, c.default.as_deref()))
        .collect();
    assert_eq!(
        listed,
        [
            ("id", "bigint unsigned", false, true, None),
            ("buyer `id`", "int", true, false, None),
            ("status", r"enum('new','it''s \\ paid')", false, false, Some("new")),
        ],
    );
    let reference = MySqlReference { database: name.clone(), table: "клиенты ü".into(), column: "id key".into() };
    assert_eq!(columns[1].references, Some(reference));
    assert_eq!(columns[0].references, None);
    assert_eq!(columns[2].enum_values, Some(vec![String::from("new"), String::from(r"it's \ paid")]));
    assert_eq!(columns[0].enum_values, None);

    // A unique, not-null column is not mistaken for the primary key.
    let keyed = mysql_columns(&pool, &name, "клиенты ü").await.unwrap();
    assert_eq!(keyed.iter().map(|c| c.is_primary_key).collect::<Vec<_>>(), [true, false]);
    drop_seeded(&config, pool, &name).await;
}

#[tokio::test]
async fn only_a_generated_column_is_flagged_generated() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = database("generated");
    let pool = seeded(&config, &name).await;
    let mut admin = connect(&config, "").await;
    run(
        &mut admin,
        &format!(
            "CREATE TABLE {}.`мерки ü` (id INT AUTO_INCREMENT PRIMARY KEY, side INT, \
             area INT AS (side * side) VIRTUAL, `half ``side``` DOUBLE AS (side / 2) STORED, \
             made DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)",
            quoted(&name)
        ),
    )
    .await;
    let columns = mysql_columns(&pool, &name, "мерки ü").await.unwrap();
    let flagged: Vec<(&str, bool)> = columns.iter().map(|c| (c.name.as_str(), c.generated)).collect();
    assert_eq!(flagged, [("id", false), ("side", false), ("area", true), ("half `side`", true), ("made", false)]);
    let numbered: Vec<bool> = columns.iter().map(|c| c.auto_increment).collect();
    assert_eq!(numbered, [true, false, false, false, false]);
    admin.close().await.unwrap();
    drop_seeded(&config, pool, &name).await;
}

#[tokio::test]
async fn foreign_keys_are_listed_from_either_side_whole_and_across_databases() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let (name, other) = (database("keys"), database("keys elsewhere"));
    let pool = seeded(&config, &name).await;
    let mut admin = connect(&config, "").await;
    for statement in [
        format!("DROP DATABASE IF EXISTS {}", quoted(&other)),
        format!("CREATE DATABASE {}", quoted(&other)),
        format!("CREATE TABLE {}.`склад` (`zone ``z``` INT, slot INT, PRIMARY KEY (slot, `zone ``z```))", quoted(&other)),
        format!(
            "CREATE TABLE {}.`shelf ü` (id INT PRIMARY KEY, `at zone` INT, `at slot` INT, \
             CONSTRAINT `shelf, place` FOREIGN KEY (`at slot`, `at zone`) REFERENCES {}.`склад` (slot, `zone ``z```))",
            quoted(&name),
            quoted(&other)
        ),
    ] {
        run(&mut admin, &statement).await;
    }
    let key = |from: (&str, &str, &[&str]), to: (&str, &str, &[&str])| MySqlForeignKey {
        from_database: from.0.into(),
        from_table: from.1.into(),
        from_columns: from.2.iter().map(|c| c.to_string()).collect(),
        to_database: to.0.into(),
        to_table: to.1.into(),
        to_columns: to.2.iter().map(|c| c.to_string()).collect(),
    };
    let shelf = key((&name, "shelf ü", &["at slot", "at zone"]), (&other, "склад", &["slot", "zone `z`"]));
    let buyer = key((&name, "order items", &["buyer `id`"]), (&name, "клиенты ü", &["id key"]));
    assert_eq!(mysql_foreign_keys(&pool, &name, "shelf ü").await.unwrap(), std::slice::from_ref(&shelf));
    assert_eq!(mysql_foreign_keys(&pool, &other, "склад").await.unwrap(), [shelf]);
    assert_eq!(mysql_foreign_keys(&pool, &name, "клиенты ü").await.unwrap(), std::slice::from_ref(&buyer));
    assert_eq!(mysql_foreign_keys(&pool, &name, "order items").await.unwrap(), [buyer]);
    // The shelf's database first: its key holds the other's table.
    drop_seeded(&config, pool, &name).await;
    run(&mut admin, &format!("DROP DATABASE {}", quoted(&other))).await;
    admin.close().await.unwrap();
}
