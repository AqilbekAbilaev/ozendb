//! Live-PostgreSQL coverage of the function/procedure browser reads
//! (`list_routines_impl`, `routine_source_impl`). Shares `pg.rs`'s
//! helpers and skip behaviour; see its module doc comment for how to run these.

use crate::commands::{list_routines_impl, routine_source_impl};
use super::pg::{pool, test_config};

// Each test seeds a schema of its own: they run concurrently, and sharing one name
// means racing on its DROP and CREATE.
async fn seeded(schema: &str) -> Option<sqlx::PgPool> {
    let config = test_config()?;
    let pool = pool(&config).await;
    for stmt in [
        format!("DROP SCHEMA IF EXISTS {schema} CASCADE"),
        format!("CREATE SCHEMA {schema}"),
        format!(
            "CREATE FUNCTION {schema}.add_up(a integer, b integer) RETURNS integer \
             LANGUAGE sql IMMUTABLE AS $$ SELECT a + b $$"
        ),
        // Overloaded: same name, different arguments — the reason the source read is
        // keyed by oid rather than by name.
        format!(
            "CREATE FUNCTION {schema}.add_up(a text, b text) RETURNS text \
             LANGUAGE sql IMMUTABLE AS $$ SELECT a || b $$"
        ),
        format!(
            "CREATE PROCEDURE {schema}.do_nothing() LANGUAGE plpgsql AS $$ BEGIN END $$"
        ),
        // An aggregate, which v1 deliberately leaves out of the listing.
        format!("CREATE AGGREGATE {schema}.total(integer) (SFUNC = int4pl, STYPE = integer)"),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(stmt.clone()))
            .execute(&pool)
            .await
            .unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }
    Some(pool)
}

#[tokio::test]
async fn lists_functions_and_procedures_but_not_aggregates() {
    let schema = "ozendb_it_routines_list";
    let pool = match seeded(schema).await {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let routines = list_routines_impl(&pool, Some(schema)).await.expect("routines");

    let names: Vec<&str> = routines.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["add_up", "add_up", "do_nothing"], "listing: {names:?}");
    assert!(!names.contains(&"total"), "an aggregate reached a v1 listing");

    let procedure = routines.iter().find(|r| r.name == "do_nothing").expect("the procedure");
    assert_eq!(procedure.kind, "procedure");
    assert_eq!(procedure.language, "plpgsql");
    // A procedure returns nothing, so it says nothing rather than claiming void.
    assert_eq!(procedure.return_type, None);
    assert_eq!(procedure.arguments, "");

    let functions: Vec<_> = routines.iter().filter(|r| r.name == "add_up").collect();
    assert!(functions.iter().all(|f| f.kind == "function"));
    assert!(functions.iter().all(|f| f.return_type.is_some()));
    // The two overloads are told apart by their rendered argument lists.
    assert!(functions.iter().any(|f| f.arguments.contains("integer")));
    assert!(functions.iter().any(|f| f.arguments.contains("text")));

    sqlx::query(sqlx::AssertSqlSafe(format!("DROP SCHEMA {schema} CASCADE"))).execute(&pool).await.ok();
}

#[tokio::test]
async fn the_source_is_the_servers_own_create_statement() {
    let schema = "ozendb_it_routines_src";
    let pool = match seeded(schema).await {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let routines = list_routines_impl(&pool, Some(schema)).await.expect("routines");
    let integer_overload = routines
        .iter()
        .find(|r| r.name == "add_up" && r.arguments.contains("integer"))
        .expect("the integer overload");

    let source = routine_source_impl(&pool, integer_overload.oid).await.expect("source");
    assert!(source.starts_with("CREATE OR REPLACE FUNCTION"), "source: {source}");
    assert!(source.contains("a + b"), "body missing from: {source}");
    // The oid picked the right overload of two same-named functions.
    assert!(source.contains("integer"), "wrong overload: {source}");
    assert!(!source.contains("a || b"), "the text overload's body leaked in");

    sqlx::query(sqlx::AssertSqlSafe(format!("DROP SCHEMA {schema} CASCADE"))).execute(&pool).await.ok();
}

#[tokio::test]
async fn listing_every_schema_leaves_out_the_servers_own() {
    let schema = "ozendb_it_routines_all";
    let pool = match seeded(schema).await {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let all = list_routines_impl(&pool, None).await.expect("routines");
    assert!(all.iter().any(|r| r.schema == schema), "the seeded schema is missing");
    assert!(
        all.iter().all(|r| r.schema != "information_schema" && !r.schema.starts_with("pg_")),
        "a system schema's routines reached the listing",
    );

    sqlx::query(sqlx::AssertSqlSafe(format!("DROP SCHEMA {schema} CASCADE"))).execute(&pool).await.ok();
}

#[tokio::test]
async fn a_routine_that_is_gone_says_so() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    // An oid no routine holds: the read must report it, not return an empty string.
    let missing = routine_source_impl(&pool, 999_999_999).await;
    assert!(missing.is_err(), "a missing routine returned a source");
}
