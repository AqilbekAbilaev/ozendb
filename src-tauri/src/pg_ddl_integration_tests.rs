//! Live-PostgreSQL coverage of the sidebar's schema changes (`create_schema_impl`,
//! `create_table_impl`, `rename_table_impl`, `drop_table_impl`, `drop_schema_impl`).
//! Shares `pg_integration_tests.rs`'s helpers and skip behaviour; see its module doc
//! comment for how to run these.

use crate::commands::{
    create_schema_impl, create_table_impl, drop_schema_impl, drop_table_impl, list_columns_impl, list_schemas_impl,
    list_tables_impl, rename_table_impl, NewPgColumn, NewPgTable,
};
use crate::error::AppError;
use crate::pg_integration_tests::{pool, test_config};

fn column(name: &str, data_type: &str, primary_key: bool) -> NewPgColumn {
    NewPgColumn { name: name.into(), data_type: data_type.into(), nullable: true, primary_key, identity: primary_key }
}

async fn reset(pool: &sqlx::PgPool, schema: &str) {
    sqlx::query(sqlx::AssertSqlSafe(format!("DROP SCHEMA IF EXISTS \"{schema}\" CASCADE")))
        .execute(pool)
        .await
        .expect("reset schema");
}

async fn table_names(pool: &sqlx::PgPool, schema: &str) -> Vec<String> {
    list_tables_impl(pool, schema).await.expect("tables").into_iter().map(|t| t.name).collect()
}

#[tokio::test]
async fn schema_and_table_round_trip() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let schema = "ozendb_ddl it";
    reset(&pool, schema).await;

    create_schema_impl(&pool, schema).await.expect("create schema");
    assert!(list_schemas_impl(&pool).await.unwrap().iter().any(|s| s.name == schema));

    let table = NewPgTable {
        schema: schema.into(),
        name: "Order Lines".into(),
        columns: vec![column("id", "bigint", true), column("price", "numeric(10,2)", false), column("tags", "text[]", false)],
    };
    create_table_impl(&pool, &table).await.expect("create table");
    let columns = list_columns_impl(&pool, schema, "Order Lines").await.expect("columns");
    let id = columns.iter().find(|c| c.name == "id").expect("id column");
    assert!(id.is_primary_key);
    assert_eq!(id.identity.as_deref(), Some("by_default"));
    // Typed modifiers survive: the type text goes in as the user wrote it, once checked.
    assert!(columns.iter().any(|c| c.name == "price" && c.data_type == "numeric(10,2)"));
    assert!(columns.iter().any(|c| c.name == "tags" && c.data_type == "text[]"));

    rename_table_impl(&pool, schema, "Order Lines", "lines").await.expect("rename");
    assert_eq!(table_names(&pool, schema).await, vec![String::from("lines")]);

    drop_table_impl(&pool, schema, "lines", false).await.expect("drop table");
    assert!(table_names(&pool, schema).await.is_empty());

    drop_schema_impl(&pool, schema, false).await.expect("drop schema");
    assert!(!list_schemas_impl(&pool).await.unwrap().iter().any(|s| s.name == schema));
}

#[tokio::test]
async fn an_unknown_or_smuggled_type_is_refused_before_anything_runs() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let schema = "ozendb_ddl_types";
    reset(&pool, schema).await;
    create_schema_impl(&pool, schema).await.expect("create schema");

    for bad in ["notatype", "serial", "int) ; DROP SCHEMA ozendb_ddl_types CASCADE; --", "int, evil text"] {
        let table = NewPgTable { schema: schema.into(), name: "t".into(), columns: vec![column("a", bad, false)] };
        match create_table_impl(&pool, &table).await {
            Err(AppError::Validation(message)) => assert!(message.contains("isn't a type"), "{message}"),
            other => panic!("{bad:?} was not refused as a type: {other:?}"),
        }
    }
    assert!(list_schemas_impl(&pool).await.unwrap().iter().any(|s| s.name == schema), "schema was dropped");
    assert!(table_names(&pool, schema).await.is_empty());
    reset(&pool, schema).await;
}

#[tokio::test]
async fn a_schema_with_tables_needs_cascade() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let schema = "ozendb_ddl_cascade";
    reset(&pool, schema).await;
    create_schema_impl(&pool, schema).await.unwrap();
    let table = NewPgTable { schema: schema.into(), name: "t".into(), columns: vec![column("a", "int", false)] };
    create_table_impl(&pool, &table).await.unwrap();

    assert!(drop_schema_impl(&pool, schema, false).await.is_err(), "dropped a non-empty schema without CASCADE");
    drop_schema_impl(&pool, schema, true).await.expect("drop with cascade");
    assert!(!list_schemas_impl(&pool).await.unwrap().iter().any(|s| s.name == schema));
}

#[tokio::test]
async fn a_drop_blocked_by_an_open_transaction_gives_up_instead_of_hanging() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let schema = "ozendb_ddl_lock";
    reset(&pool, schema).await;
    create_schema_impl(&pool, schema).await.unwrap();
    let table = NewPgTable { schema: schema.into(), name: "t".into(), columns: vec![column("a", "int", false)] };
    create_table_impl(&pool, &table).await.unwrap();

    // A tab's open transaction that has read the table holds a lock the drop must wait on.
    let mut holder = pool.begin().await.unwrap();
    sqlx::query("SELECT * FROM ozendb_ddl_lock.t").execute(&mut *holder).await.unwrap();

    let started = std::time::Instant::now();
    let error = drop_table_impl(&pool, schema, "t", false).await.expect_err("drop should give up");
    assert!(started.elapsed() < std::time::Duration::from_secs(15), "the drop waited {:?}", started.elapsed());
    let json = serde_json::to_value(&error).unwrap();
    assert!(json["message"].as_str().unwrap().contains("open transaction"), "{json}");

    holder.rollback().await.unwrap();
    reset(&pool, schema).await;
}
