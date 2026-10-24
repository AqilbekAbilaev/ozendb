//! Live tests of the MySQL sidebar's stored programs, against the server `mysql.rs` describes.

use super::mysql::{connect, run, test_config, SKIP};
use super::mysql_browse::{pool, quoted};
use crate::commands::mysql_stored_programs;
use crate::storage::ConnectionConfig;

/// A database of its own per test, holding a table, a procedure and a function that share
/// a name, a function, a trigger and two events, all awkwardly named. The caller drops it.
async fn seeded(config: &ConnectionConfig, name: &str) -> String {
    let database = quoted(&format!("ozendb it `programs` ü {name}"));
    let mut admin = connect(config, "").await;
    for statement in [
        format!("DROP DATABASE IF EXISTS {database}"),
        format!("CREATE DATABASE {database}"),
        format!("CREATE TABLE {database}.`order items` (id INT PRIMARY KEY)"),
        format!("CREATE PROCEDURE {database}.`same ``name`` ü`() SELECT 1"),
        format!("CREATE FUNCTION {database}.`same ``name`` ü`() RETURNS INT DETERMINISTIC RETURN 1"),
        format!("CREATE FUNCTION {database}.`a; f`(n INT) RETURNS VARCHAR(10) DETERMINISTIC RETURN 'x'"),
        format!("CREATE TRIGGER {database}.`stamp ü` BEFORE INSERT ON {database}.`order items` FOR EACH ROW SET NEW.id = NEW.id + 1"),
        format!("CREATE EVENT {database}.`nightly ü` ON SCHEDULE EVERY 1 DAY DO DELETE FROM {database}.`order items`"),
        format!("CREATE EVENT {database}.`once` ON SCHEDULE AT '2030-01-01 00:00:00' DISABLE DO DELETE FROM {database}.`order items`"),
    ] {
        run(&mut admin, &statement).await;
    }
    database
}

async fn drop_seeded(config: &ConnectionConfig, database: &str) {
    run(&mut connect(config, "").await, &format!("DROP DATABASE {database}")).await;
}

fn unquoted(database: &str) -> String {
    database[1..database.len() - 1].replace("``", "`")
}

#[tokio::test]
async fn procedures_and_functions_are_listed_apart_even_under_one_name() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = seeded(&config, "routines").await;
    let programs = mysql_stored_programs(&pool(&config).await, &unquoted(&database)).await.unwrap();
    let routines: Vec<_> = programs.routines.iter().map(|r| (r.name.as_str(), r.kind.as_str(), r.returns.as_deref())).collect();
    assert_eq!(
        routines,
        [("a; f", "function", Some("varchar(10)")), ("same `name` ü", "function", Some("int")), ("same `name` ü", "procedure", None)]
    );
    drop_seeded(&config, &database).await;
}

#[tokio::test]
async fn triggers_are_listed_with_their_table_and_when_they_fire() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = seeded(&config, "triggers").await;
    let programs = mysql_stored_programs(&pool(&config).await, &unquoted(&database)).await.unwrap();
    let triggers: Vec<_> = programs.triggers.iter().map(|t| (t.name.as_str(), t.table.as_str(), t.timing.as_str(), t.event.as_str())).collect();
    assert_eq!(triggers, [("stamp ü", "order items", "BEFORE", "INSERT")]);
    drop_seeded(&config, &database).await;
}

#[tokio::test]
async fn events_are_listed_with_their_schedule_and_status_whether_or_not_the_scheduler_runs() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = seeded(&config, "events").await;
    let programs = mysql_stored_programs(&pool(&config).await, &unquoted(&database)).await.unwrap();
    let events: Vec<_> = programs.events.iter().map(|e| (e.name.as_str(), e.schedule.as_str(), e.status.as_str())).collect();
    assert_eq!(events, [("nightly ü", "EVERY 1 DAY", "ENABLED"), ("once", "AT 2030-01-01 00:00:00", "DISABLED")]);
    drop_seeded(&config, &database).await;
}
