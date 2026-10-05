//! Live-PostgreSQL coverage of the error codes the frontend branches on for a table it
//! can't read, or that's gone. Shares `pg.rs`'s helpers and skip
//! behaviour; see its module doc comment for how to run these.

use crate::error::AppError;
use super::pg::{pool, test_config};

#[tokio::test]
async fn permission_denied_and_missing_tables_get_their_own_codes() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP TABLE IF EXISTS ozendb_it_private",
        "CREATE TABLE ozendb_it_private (id int)",
        "DO $$ BEGIN CREATE ROLE ozendb_it_nobody; EXCEPTION WHEN duplicate_object THEN NULL; END $$",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }

    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE ozendb_it_nobody").execute(&mut *tx).await.unwrap();
    let denied = AppError::Postgres(sqlx::query("SELECT * FROM ozendb_it_private").execute(&mut *tx).await.unwrap_err());
    assert_eq!(denied.code(), "forbidden");
    tx.rollback().await.unwrap();

    let missing = AppError::Postgres(sqlx::query("SELECT * FROM ozendb_it_gone").execute(&pool).await.unwrap_err());
    assert_eq!(missing.code(), "missing");
    let no_schema = AppError::Postgres(sqlx::query("CREATE TABLE ozendb_no_schema.t (id int)").execute(&pool).await.unwrap_err());
    assert_eq!(no_schema.code(), "missing");

    sqlx::query("DROP TABLE ozendb_it_private").execute(&pool).await.unwrap();
    sqlx::query("DROP ROLE ozendb_it_nobody").execute(&pool).await.unwrap();
}
