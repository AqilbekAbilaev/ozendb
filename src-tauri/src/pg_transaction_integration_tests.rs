//! Live-PostgreSQL coverage of the SQL tab's Manual mode: a transaction held open
//! across runs, then committed or rolled back. Shares `pg_integration_tests.rs`'s
//! helpers and skip behaviour; see its module doc comment for how to run these.

use crate::commands::{run_query_as, PgTransactions};
use crate::error::AppError;
use crate::pg_integration_tests::{pool, test_config};

fn shown(err: &AppError) -> String {
    serde_json::to_value(err).unwrap()["message"].as_str().unwrap().to_string()
}

async fn count(pool: &sqlx::PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM ozendb_it_tx.t").fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn a_held_transaction_is_seen_only_by_itself_until_committed_or_rolled_back() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in ["DROP SCHEMA IF EXISTS ozendb_it_tx CASCADE", "CREATE SCHEMA ozendb_it_tx", "CREATE TABLE ozendb_it_tx.t (id int PRIMARY KEY)"] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }
    let txs = PgTransactions::default();

    txs.begin(&pool, "tx-1", false).await.unwrap();
    let inserted = txs.run("tx-1", "INSERT INTO ozendb_it_tx.t VALUES (1), (2)", None).await.unwrap();
    assert_eq!(inserted.rows_affected, Some(2));
    let inside = txs.run("tx-1", "SELECT count(*) FROM ozendb_it_tx.t", None).await.unwrap();
    assert_eq!(inside.rows[0], vec![serde_json::json!(2)]);
    assert_eq!(count(&pool).await, 0, "uncommitted rows are invisible elsewhere");
    txs.finish("tx-1", true).await.unwrap();
    assert_eq!(count(&pool).await, 2);

    txs.begin(&pool, "tx-2", false).await.unwrap();
    txs.run("tx-2", "DELETE FROM ozendb_it_tx.t", None).await.unwrap();
    txs.finish("tx-2", false).await.unwrap();
    assert_eq!(count(&pool).await, 2, "rolled back");

    let err = txs.run("tx-2", "SELECT 1", None).await.unwrap_err();
    assert!(shown(&err).contains("already ended"), "{}", shown(&err));

    sqlx::query("DROP SCHEMA ozendb_it_tx CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn commit_after_an_error_says_nothing_was_committed_rather_than_pretend() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    sqlx::query("CREATE TABLE IF NOT EXISTS ozendb_it_tx_fail (id int)").execute(&pool).await.unwrap();
    let txs = PgTransactions::default();

    txs.begin(&pool, "tx-f", false).await.unwrap();
    txs.run("tx-f", "INSERT INTO ozendb_it_tx_fail VALUES (1)", None).await.unwrap();
    assert!(txs.run("tx-f", "SELECT 1/0", None).await.is_err());
    let err = txs.finish("tx-f", true).await.unwrap_err();
    assert!(shown(&err).contains("nothing was committed"), "{}", shown(&err));
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM ozendb_it_tx_fail").fetch_one(&pool).await.unwrap();
    assert_eq!(n, 0);
    // A run refused before reaching the server doesn't count as an error in it.
    txs.begin(&pool, "tx-g", false).await.unwrap();
    assert!(txs.run("tx-g", "BEGIN", None).await.is_err());
    txs.run("tx-g", "INSERT INTO ozendb_it_tx_fail VALUES (2)", None).await.unwrap();
    txs.finish("tx-g", true).await.unwrap();
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM ozendb_it_tx_fail").fetch_one(&pool).await.unwrap();
    assert_eq!(n, 1);

    sqlx::query("DROP TABLE ozendb_it_tx_fail").execute(&pool).await.unwrap();
    let _ = run_query_as(&pool, "SELECT 1", false, None).await.unwrap();
}

#[tokio::test]
async fn a_read_only_connection_holds_a_read_only_transaction() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let txs = PgTransactions::default();
    txs.begin(&pool, "tx-r", true).await.unwrap();
    let err = txs.run("tx-r", "CREATE TABLE ozendb_it_tx_never (id int)", None).await.unwrap_err();
    assert!(err.to_string().contains("read-only"), "{err}");
    txs.finish("tx-r", false).await.unwrap();
}
