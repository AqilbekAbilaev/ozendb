//! Live tests of MySQL's process list and its kills, against the server `mysql.rs`
//! describes.

use super::mysql::{connect, run, test_config, SKIP};
use super::mysql_browse::pool;
use super::mysql_users::pool_as;
use crate::commands::{mysql_kill_connection, mysql_kill_query, mysql_processes};
use std::time::{Duration, Instant};

#[tokio::test]
async fn a_running_statement_is_listed_stopped_and_then_its_connection_closed() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool(&config).await;
    let mut sleeper = connect(&config, "").await;
    let sleeper_id: i64 = sqlx::query_scalar("SELECT CAST(CONNECTION_ID() AS SIGNED)").fetch_one(&mut sleeper).await.unwrap();
    let started = Instant::now();
    let sleeping = tokio::spawn(async move {
        let slept: i64 = sqlx::query_scalar("SELECT SLEEP(30)").fetch_one(&mut sleeper).await.unwrap();
        (slept, sleeper)
    });

    let deadline = Instant::now() + Duration::from_secs(5);
    let listed = loop {
        let processes = mysql_processes(&pool).await.unwrap();
        if let Some(found) = processes.into_iter().find(|p| p.id == sleeper_id && p.query.is_some()) {
            break found;
        }
        assert!(Instant::now() < deadline, "the sleeping statement never showed in the list");
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    // A prepared statement shows as Execute rather than Query.
    assert_eq!((listed.command.as_str(), listed.idle, listed.query.as_deref(), listed.is_self), ("Execute", false, Some("SELECT SLEEP(30)"), false));

    assert!(mysql_kill_query(&pool, sleeper_id).await.unwrap());
    let (slept, _sleeper) = tokio::time::timeout(Duration::from_secs(10), sleeping).await.unwrap().unwrap();
    assert_eq!(slept, 1, "a stopped SLEEP returns 1");
    assert!(started.elapsed() < Duration::from_secs(20));

    assert!(mysql_kill_connection(&pool, sleeper_id).await.unwrap());
    let deadline = Instant::now() + Duration::from_secs(5);
    while mysql_processes(&pool).await.unwrap().iter().any(|p| p.id == sleeper_id) {
        assert!(Instant::now() < deadline, "the closed connection stayed in the list");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(!mysql_kill_connection(&pool, sleeper_id).await.unwrap(), "a connection already gone is not an error");
}

#[tokio::test]
async fn a_login_without_process_sees_only_its_own_connections_and_may_not_stop_others() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let (user, password) = ("ozendb_it_activity_low", "low ü");
    let mut admin = connect(&config, "").await;
    run(&mut admin, &format!("DROP USER IF EXISTS '{user}'@'%'")).await;
    run(&mut admin, &format!("CREATE USER '{user}'@'%' IDENTIFIED BY '{password}'")).await;
    let admin_id: i64 = sqlx::query_scalar("SELECT CAST(CONNECTION_ID() AS SIGNED)").fetch_one(&mut admin).await.unwrap();
    let low = pool_as(&config, user, password).await;

    let processes = mysql_processes(&low).await.unwrap();
    assert!(processes.iter().all(|p| p.user == user), "without PROCESS only the login's own connections are listed");
    assert_eq!(processes.iter().filter(|p| p.is_self).count(), 1);

    let refused = mysql_kill_query(&low, admin_id).await.err().unwrap();
    assert_eq!(refused.code(), "forbidden");
    assert!(refused.to_string().contains(&format!("stopping connection {admin_id} needs CONNECTION_ADMIN")), "{refused}");

    low.close().await;
    run(&mut admin, &format!("DROP USER '{user}'@'%'")).await;
}
