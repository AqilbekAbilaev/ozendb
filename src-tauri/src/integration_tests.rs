//! Integration tests against a live MongoDB.
//!
//! These are skipped unless `OZENDB_TEST_MONGODB` is set (to a `host` or
//! `host:port`). When set, they exercise the real URI-building + driver paths the
//! commands rely on — paging `find`, `count_documents`, and `aggregate` — against
//! a throwaway database that is dropped at the end. Default `cargo test` stays
//! green everywhere because each test returns early when the variable is absent.
//!
//! Run them with, e.g.:
//!   OZENDB_TEST_MONGODB=127.0.0.1:27017 cargo test integration

use crate::storage::{ConnectionConfig, HostEntry};
use crate::uri;
use mongodb::bson::{doc, Document};
use mongodb::Client;

/// A `ConnectionConfig` pointing at the test server, or `None` when the env var
/// is unset (so the caller skips).
fn test_config() -> Option<ConnectionConfig> {
    let target = match std::env::var("OZENDB_TEST_MONGODB") {
        Ok(val) => val,
        Err(_) => return None,
    };
    let (host, port) = match target.split_once(':') {
        Some((h, p)) => {
            let parsed = match p.parse::<u16>() {
                Ok(val) => val,
                Err(_) => 27017,
            };
            (h.to_string(), parsed)
        }
        None => (target, 27017),
    };
    Some(ConnectionConfig {
        id: String::from("it-test"),
        name: String::from("integration-test"),
        hosts: vec![HostEntry { host: host, port: port }],
        ..Default::default()
    })
}

/// Connect the way the pool does: build the URI from the config, add the standard
/// timeouts, and hand it to the driver.
async fn connect(config: &ConnectionConfig) -> Client {
    let built = uri::with_timeout(&uri::build_uri(
        config,
        config.engine.as_mongo().expect("the integration config is MongoDB"),
        None,
    ));
    match Client::with_uri_str(&built).await {
        Ok(val) => val,
        Err(e) => panic!("could not connect to test MongoDB: {}", e),
    }
}

#[tokio::test]
async fn find_paging_and_count_round_trip() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_MONGODB=host[:port] to run live tests");
            return;
        }
    };
    let client = connect(&config).await;
    let db = client.database("ozendb_it");
    let col = db.collection::<Document>("paging");

    // Start from a clean slate.
    match col.drop().await {
        Ok(_) => {}
        Err(e) => panic!("drop collection: {}", e),
    }

    // Insert 25 ordered docs.
    let mut docs = Vec::new();
    for n in 0..25 {
        docs.push(doc! { "n": n });
    }
    match col.insert_many(docs).await {
        Ok(_) => {}
        Err(e) => panic!("insert_many: {}", e),
    }

    // find with sort + skip + limit — the paging the find_documents command does.
    let mut cursor = match col
        .find(doc! {})
        .sort(doc! { "n": 1 })
        .skip(10)
        .limit(5)
        .await
    {
        Ok(val) => val,
        Err(e) => panic!("find: {}", e),
    };
    let mut got = Vec::new();
    loop {
        let has_next = match cursor.advance().await {
            Ok(val) => val,
            Err(e) => panic!("advance: {}", e),
        };
        if !has_next {
            break;
        }
        let document: Document = match cursor.deserialize_current() {
            Ok(val) => val,
            Err(e) => panic!("deserialize: {}", e),
        };
        match document.get_i32("n") {
            Ok(val) => got.push(val),
            Err(e) => panic!("get n: {}", e),
        }
    }
    assert_eq!(got, vec![10, 11, 12, 13, 14]);

    // count_documents with a filter — the count_documents command's core.
    let count = match col.count_documents(doc! { "n": doc! { "$gte": 20 } }).await {
        Ok(val) => val,
        Err(e) => panic!("count_documents: {}", e),
    };
    assert_eq!(count, 5);

    match db.drop().await {
        Ok(_) => {}
        Err(e) => panic!("drop db: {}", e),
    }
}

#[tokio::test]
async fn update_delete_many_and_clear_round_trip() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_MONGODB=host[:port] to run live tests");
            return;
        }
    };
    let client = connect(&config).await;
    let db = client.database("ozendb_it_bulk");
    let col = db.collection::<Document>("items");

    match col.drop().await {
        Ok(_) => {}
        Err(e) => panic!("drop collection: {}", e),
    }

    let mut docs = Vec::new();
    for n in 0..10 {
        docs.push(doc! { "n": n, "tag": "keep" });
    }
    match col.insert_many(docs).await {
        Ok(_) => {}
        Err(e) => panic!("insert_many: {}", e),
    }

    // update_many: flag the low half — the Update Dialog's core path.
    let updated = match col
        .update_many(doc! { "n": doc! { "$lt": 5 } }, doc! { "$set": { "tag": "low" } })
        .await
    {
        Ok(val) => val,
        Err(e) => panic!("update_many: {}", e),
    };
    assert_eq!(updated.modified_count, 5);
    let low = match col.count_documents(doc! { "tag": "low" }).await {
        Ok(val) => val,
        Err(e) => panic!("count low: {}", e),
    };
    assert_eq!(low, 5);

    // delete_many: remove the low half — the Delete Dialog's core path.
    let deleted = match col.delete_many(doc! { "tag": "low" }).await {
        Ok(val) => val,
        Err(e) => panic!("delete_many: {}", e),
    };
    assert_eq!(deleted.deleted_count, 5);

    // clear_collection: empty filter removes the rest while the collection remains.
    let cleared = match col.delete_many(doc! {}).await {
        Ok(val) => val,
        Err(e) => panic!("clear delete_many: {}", e),
    };
    assert_eq!(cleared.deleted_count, 5);
    let remaining = match col.count_documents(doc! {}).await {
        Ok(val) => val,
        Err(e) => panic!("count remaining: {}", e),
    };
    assert_eq!(remaining, 0);

    match db.drop().await {
        Ok(_) => {}
        Err(e) => panic!("drop db: {}", e),
    }
}

#[tokio::test]
async fn aggregate_round_trip() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_MONGODB=host[:port] to run live tests");
            return;
        }
    };
    let client = connect(&config).await;
    let db = client.database("ozendb_it_agg");
    let col = db.collection::<Document>("nums");

    match col.drop().await {
        Ok(_) => {}
        Err(e) => panic!("drop collection: {}", e),
    }

    let mut docs = Vec::new();
    for n in 1..=10 {
        docs.push(doc! { "n": n, "even": n % 2 == 0 });
    }
    match col.insert_many(docs).await {
        Ok(_) => {}
        Err(e) => panic!("insert_many: {}", e),
    }

    // $match + $count — the run_aggregate command's pipeline execution path.
    let pipeline = vec![
        doc! { "$match": { "even": true } },
        doc! { "$count": "evens" },
    ];
    let mut cursor = match col.aggregate(pipeline).await {
        Ok(val) => val,
        Err(e) => panic!("aggregate: {}", e),
    };
    let has_next = match cursor.advance().await {
        Ok(val) => val,
        Err(e) => panic!("advance: {}", e),
    };
    assert!(has_next, "expected a $count result");
    let result: Document = match cursor.deserialize_current() {
        Ok(val) => val,
        Err(e) => panic!("deserialize: {}", e),
    };
    match result.get_i32("evens") {
        Ok(val) => assert_eq!(val, 5),
        Err(e) => panic!("get evens: {}", e),
    }

    match db.drop().await {
        Ok(_) => {}
        Err(e) => panic!("drop db: {}", e),
    }
}
