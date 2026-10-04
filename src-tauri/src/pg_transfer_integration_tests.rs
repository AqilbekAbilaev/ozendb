//! Live-PostgreSQL coverage of bulk export (`export_impl`, ozendb-6v3). Shares
//! `pg_integration_tests.rs`'s helpers and skip behaviour; see its module doc comment.

use crate::commands::{export_impl, import_csv_impl, import_preview_impl, PgExportSource};
use crate::pg_integration_tests::{pool, test_config};

const SCHEMA: &str = "ozendb_it_export";

async fn setup(pool: &sqlx::PgPool) {
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_export CASCADE",
        "CREATE SCHEMA ozendb_it_export",
        "CREATE TABLE ozendb_it_export.items (id integer, name text, price numeric(8,2), active boolean, seen timestamp)",
        "INSERT INTO ozendb_it_export.items VALUES \
           (1, 'plain', 9.50, true, '2026-01-02 03:04:05'), \
           (2, 'has, comma and \"quote\"', NULL, false, NULL), \
           (3, E'two\\nlines', 0.10, NULL, '2026-12-31 23:59:59')",
        "CREATE TABLE ozendb_it_export.many AS SELECT g AS n FROM generate_series(1, 10005) g",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(String::from(stmt))).execute(pool).await.expect("setup");
    }
}

fn table(name: &str) -> PgExportSource {
    PgExportSource { schema: Some(String::from(SCHEMA)), table: Some(String::from(name)), query: None }
}

fn temp_path(name: &str) -> String {
    std::env::temp_dir().join(format!("ozendb-it-export-{name}")).to_string_lossy().into_owned()
}

#[tokio::test]
async fn exports_tables_and_queries_as_csv_and_json_past_the_grid_cap() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    setup(&pool).await;

    // CSV is the server's own formatting: header, quoting, empty for NULL.
    let csv_path = temp_path("items.csv");
    export_impl(&pool, &table("items"), "csv", &csv_path).await.expect("csv export");
    let csv = std::fs::read_to_string(&csv_path).expect("read csv");
    assert_eq!(
        csv,
        "id,name,price,active,seen\n\
         1,plain,9.50,t,2026-01-02 03:04:05\n\
         2,\"has, comma and \"\"quote\"\"\",,f,\n\
         3,\"two\nlines\",0.10,,2026-12-31 23:59:59\n",
    );

    // JSON keeps column order and types, nulls included.
    let json_path = temp_path("items.json");
    let result = export_impl(&pool, &table("items"), "json", &json_path).await.expect("json export");
    assert_eq!(result.rows, Some(3));
    let parsed: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&json_path).expect("read json")).expect("valid JSON");
    assert_eq!(parsed[1]["name"], "has, comma and \"quote\"");
    assert_eq!(parsed[1]["price"], serde_json::Value::Null);
    assert_eq!(parsed[0]["price"], serde_json::json!(9.50));
    assert_eq!(parsed[0]["active"], true);
    assert_eq!(parsed[2]["name"], "two\nlines");

    // A query exports its own rows, and nothing stops at the grid's 10,000-row cap.
    let query = PgExportSource {
        schema: None,
        table: None,
        query: Some(String::from("SELECT n FROM ozendb_it_export.many WHERE n % 2 = 0 OR n > 10000;")),
    };
    let many = export_impl(&pool, &query, "json", &temp_path("many.json")).await.expect("query export");
    assert_eq!(many.rows, Some(5005));
    let all = export_impl(&pool, &table("many"), "json", &temp_path("all.json")).await.expect("table export");
    assert_eq!(all.rows, Some(10005));

    // A write dressed as an export is refused by the read-only transaction, and changes nothing.
    let write = PgExportSource {
        schema: None,
        table: None,
        query: Some(String::from("DELETE FROM ozendb_it_export.items RETURNING *")),
    };
    assert!(export_impl(&pool, &write, "csv", &temp_path("write.csv")).await.is_err());
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM ozendb_it_export.items").fetch_one(&pool).await.expect("count");
    assert_eq!(left, 3, "the refused export must not have deleted anything");

    sqlx::query(sqlx::AssertSqlSafe(String::from("DROP SCHEMA ozendb_it_export CASCADE"))).execute(&pool).await.ok();
    for name in ["items.csv", "items.json", "many.json", "all.json", "write.csv"] {
        std::fs::remove_file(temp_path(name)).ok();
    }
}

async fn count(pool: &sqlx::PgPool, table: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT count(*) FROM ozendb_it_import.{table}")))
        .fetch_one(pool)
        .await
        .expect("count")
}

fn write_file(name: &str, text: &str) -> String {
    let path = temp_path(name);
    std::fs::write(&path, text).expect("write the CSV");
    path
}

// ozendb-6v3: preview, mapped import, row-level failure, and an export → import round trip.
#[tokio::test]
async fn imports_csv_through_a_mapping_all_or_nothing() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_import CASCADE",
        "CREATE SCHEMA ozendb_it_import",
        "CREATE TABLE ozendb_it_import.people (id integer NOT NULL, name text, joined date, score numeric(5,1), \
           active boolean DEFAULT true, doubled integer GENERATED ALWAYS AS (id * 2) STORED)",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(String::from(stmt))).execute(&pool).await.expect("setup");
    }

    // Headers in another order and case, one extra column to skip.
    let good = write_file(
        "people.csv",
        "Name,ID,ignored,joined,score\n\
         \"Ada, Countess\",1,x,2026-01-02,9.5\n\
         \"two\nlines \"\"quoted\"\"\",2,y,,\n\
         \n\
         Grace,3,z,2026-03-04,7\n",
    );
    let preview = import_preview_impl(&pool, "ozendb_it_import", "people", &good, 20).await.expect("preview");
    assert_eq!(preview.headers, vec!["Name", "ID", "ignored", "joined", "score"]);
    assert_eq!(preview.rows.len(), 4, "the blank line is still a row in the preview");
    assert_eq!(
        preview.mapping,
        vec![Some("name".to_string()), Some("id".to_string()), None, Some("joined".to_string()), Some("score".to_string())],
    );
    assert!(preview.columns.iter().find(|c| c.name == "doubled").expect("doubled").generated);

    let imported = import_csv_impl(&pool, "ozendb_it_import", "people", &good, &preview.mapping).await.expect("import");
    assert_eq!(imported, 3, "the blank line is skipped");
    let rows: Vec<(i32, Option<String>, Option<String>, Option<String>, bool, i32)> = sqlx::query_as(
        "SELECT id, name, joined::text, score::text, active, doubled FROM ozendb_it_import.people ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .expect("read back");
    assert_eq!(rows[0], (1, Some("Ada, Countess".into()), Some("2026-01-02".into()), Some("9.5".into()), true, 2));
    assert_eq!(rows[1], (2, Some("two\nlines \"quoted\"".into()), None, None, true, 4), "empty fields import as NULL");
    assert_eq!(rows[2].0, 3);

    // A bad value fails the whole import, named by row and column.
    let bad = write_file("bad.csv", "id,score\n4,1.0\nfive,2.0\n6,3.0\n");
    let mapping = vec![Some("id".to_string()), Some("score".to_string())];
    let failure = import_csv_impl(&pool, "ozendb_it_import", "people", &bad, &mapping).await;
    match failure {
        Err(crate::error::AppError::Validation(message)) => {
            assert!(message.starts_with("Row 2 (column id): "), "{message}");
            assert!(message.ends_with("Nothing was imported."), "{message}");
        }
        other => panic!("expected a row-level failure, got {other:?}"),
    }
    assert_eq!(count(&pool, "people").await, 3, "row 1 of the bad file must have been rolled back");

    // A ragged row is refused before COPY sees it.
    let ragged = write_file("ragged.csv", "id,score\n7,1.0\n8\n");
    let refused = import_csv_impl(&pool, "ozendb_it_import", "people", &ragged, &mapping).await;
    assert!(matches!(refused, Err(crate::error::AppError::Validation(ref m)) if m.starts_with("Row 2 has 1 fields")), "{refused:?}");
    assert_eq!(count(&pool, "people").await, 3);

    // What export writes, import reads back.
    sqlx::query(sqlx::AssertSqlSafe(String::from(
        "CREATE TABLE ozendb_it_import.copy (LIKE ozendb_it_import.people INCLUDING DEFAULTS)",
    )))
    .execute(&pool)
    .await
    .expect("copy table");
    let source = PgExportSource {
        schema: None,
        table: None,
        query: Some(String::from("SELECT id, name, joined, score, active FROM ozendb_it_import.people")),
    };
    let exported = temp_path("round.csv");
    export_impl(&pool, &source, "csv", &exported).await.expect("export");
    let round = import_preview_impl(&pool, "ozendb_it_import", "copy", &exported, 20).await.expect("preview");
    import_csv_impl(&pool, "ozendb_it_import", "copy", &exported, &round.mapping).await.expect("round-trip import");
    let same: bool = sqlx::query_scalar(
        "SELECT NOT EXISTS (SELECT id, name, joined, score, active FROM ozendb_it_import.people \
                             EXCEPT SELECT id, name, joined, score, active FROM ozendb_it_import.copy)",
    )
    .fetch_one(&pool)
    .await
    .expect("compare");
    assert!(same, "the round trip changed the data");

    sqlx::query(sqlx::AssertSqlSafe(String::from("DROP SCHEMA ozendb_it_import CASCADE"))).execute(&pool).await.ok();
    for name in ["people.csv", "bad.csv", "ragged.csv", "round.csv"] {
        std::fs::remove_file(temp_path(name)).ok();
    }
}
