//! Live-PostgreSQL coverage of the activity monitor (`list_sessions_impl`,
//! `cancel_backend_impl`, `terminate_backend_impl`). Shares `pg.rs`'s
//! helpers and skip behaviour; see its module doc comment for how to run these.

use crate::commands::{cancel_backend_impl, list_sessions_impl, terminate_backend_impl};
use super::pg::{pool, test_config};

#[tokio::test]
async fn lists_every_session_including_this_one() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let sessions = list_sessions_impl(&pool).await.expect("sessions");

    assert!(!sessions.is_empty(), "no sessions listed at all");
    // The connection doing the asking is in the list, and marked so the UI doesn't
    // offer to kill the tab you are reading it in.
    let mine: Vec<_> = sessions.iter().filter(|s| s.is_self).collect();
    assert_eq!(mine.len(), 1, "expected exactly one session flagged as ours");
    let me = mine[0];
    assert!(me.pid > 0);
    assert!(me.database.is_some(), "our own session reports no database");
    // We are running this very statement, so our own query is visible and not redacted.
    assert!(!me.redacted, "our own query was redacted");
    assert!(me.query.as_deref().unwrap_or("").contains("pg_stat_activity"), "query: {:?}", me.query);
    assert_eq!(me.state.as_deref(), Some("active"));
}

#[tokio::test]
async fn a_redacted_query_is_reported_as_hidden_rather_than_as_text() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let sessions = list_sessions_impl(&pool).await.expect("sessions");
    // Whether anything is redacted depends on the role, so this pins the invariant
    // rather than the case: the placeholder string never reaches a caller as a query.
    for session in &sessions {
        assert_ne!(
            session.query.as_deref(),
            Some("<insufficient privilege>"),
            "the placeholder leaked through as query text for pid {}",
            session.pid,
        );
        if session.redacted {
            assert!(session.query.is_none(), "a redacted session still carried query text");
        }
    }
}

#[tokio::test]
async fn cancelling_a_pid_that_is_gone_is_false_not_an_error() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    // A pid no backend holds: Postgres answers false (with a warning) rather than
    // raising, so a row that went stale between refresh and click isn't an error.
    let cancelled = cancel_backend_impl(&pool, 2_000_000_000).await.expect("cancel a missing pid");
    assert!(!cancelled);
    let terminated = terminate_backend_impl(&pool, 2_000_000_000).await.expect("terminate a missing pid");
    assert!(!terminated);
}

#[tokio::test]
async fn terminating_a_session_closes_it() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    // A second pool gives a real session of our own to kill, rather than someone's.
    let victim = pool(&config).await;
    let watcher = pool(&config).await;
    let victim_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&victim)
        .await
        .expect("the victim's pid");

    let before = list_sessions_impl(&watcher).await.expect("sessions before");
    assert!(before.iter().any(|s| s.pid == victim_pid), "the victim session is not listed");

    assert!(terminate_backend_impl(&watcher, victim_pid).await.expect("terminate"));

    // The backend is gone, so it drops out of the listing.
    let after = list_sessions_impl(&watcher).await.expect("sessions after");
    assert!(!after.iter().any(|s| s.pid == victim_pid), "the terminated session is still listed");
}
