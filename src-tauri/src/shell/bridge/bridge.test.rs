use super::*;

#[test]
fn to_document_parses_plain_object() {
    let value = serde_json::json!({ "a": 1, "b": "x" });
    let doc = to_document(&value).unwrap();
    assert!(doc.contains_key("a"));
    assert_eq!(doc.get_str("b").unwrap(), "x");
}

#[test]
fn to_document_decodes_objectid_ejson() {
    // The shell's ObjectId("…") constructor produces { $oid: "…" }; it must
    // round-trip to a real BSON ObjectId, like the find/aggregate commands.
    let value = serde_json::json!({ "_id": { "$oid": "507f1f77bcf86cd799439011" } });
    let doc = to_document(&value).unwrap();
    match doc.get("_id") {
        Some(bson::Bson::ObjectId(oid)) => {
            assert_eq!(oid.to_hex(), "507f1f77bcf86cd799439011")
        }
        other => panic!("expected ObjectId, got {:?}", other),
    }
}

#[test]
fn to_document_treats_null_as_empty() {
    let doc = to_document(&serde_json::Value::Null).unwrap();
    assert!(doc.is_empty());
}

#[test]
fn to_document_rejects_non_objects() {
    assert!(to_document(&serde_json::json!([1, 2, 3])).is_err());
    assert!(to_document(&serde_json::json!(5)).is_err());
    assert!(to_document(&serde_json::json!("hello")).is_err());
}

#[test]
fn arg_doc_defaults_to_empty_when_missing() {
    let args: Vec<serde_json::Value> = Vec::new();
    let doc = arg_doc(&args, 0).unwrap();
    assert!(doc.is_empty());
}

// ── read-only guard: only known reads run ──────────────────────────────────

fn args(values: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    values
}

fn refused(method: &str, values: Vec<serde_json::Value>) -> bool {
    read_only_refusal(method, &args(values)).is_some()
}

#[test]
fn write_methods_are_refused() {
    for method in [
        "insertOne",
        "insertMany",
        "updateOne",
        "updateMany",
        "replaceOne",
        "deleteOne",
        "deleteMany",
        "drop",
        "createIndex",
        "dropIndex",
        "renameCollection",
    ] {
        assert!(refused(method, vec![]), "{} should be refused", method);
    }
}

#[test]
fn read_methods_run() {
    for method in ["find", "findOne", "countDocuments", "distinct", "estimatedDocumentCount"] {
        assert!(!refused(method, vec![serde_json::json!({})]), "{} should run", method);
    }
    let read = serde_json::json!([{ "$match": {} }, { "$group": { "_id": null } }]);
    assert!(!refused("aggregate", vec![read]));
}

#[test]
fn an_unknown_method_is_refused() {
    assert!(refused("bulkWrite", vec![]));
    assert_eq!(read_only_refusal("bulkWrite", &[]).as_deref(), Some("`bulkWrite`"));
}

#[test]
fn read_commands_run() {
    for command in [
        serde_json::json!({ "listCollections": 1 }),
        serde_json::json!({ "collStats": "users" }),
        serde_json::json!({ "dbStats": 1 }),
        serde_json::json!({ "ping": 1 }),
        serde_json::json!({ "count": "users", "query": {} }),
        serde_json::json!({ "explain": { "delete": "users", "deletes": [] } }),
    ] {
        assert!(!refused("runCommand", vec![command.clone()]), "{} should run", command);
    }
}

#[test]
fn write_commands_are_refused() {
    for command in [
        serde_json::json!({ "drop": "users" }),
        serde_json::json!({ "dropDatabase": 1 }),
        serde_json::json!({ "createUser": "bob", "pwd": "x" }),
        serde_json::json!({ "renameCollection": "a.b", "to": "a.c" }),
        serde_json::json!({ "collMod": "users" }),
    ] {
        assert!(refused("runCommand", vec![command.clone()]), "{} should be refused", command);
    }
}

#[test]
fn a_write_command_nobody_listed_is_refused() {
    // The bug a list of writes had: these went straight through.
    for command in [
        serde_json::json!({ "createSearchIndexes": "users", "indexes": [] }),
        serde_json::json!({ "updateSearchIndex": "users", "name": "default", "definition": {} }),
        serde_json::json!({ "dropSearchIndex": "users", "name": "default" }),
        serde_json::json!({ "setIndexCommitQuorum": "users", "indexNames": ["a_1"], "commitQuorum": 1 }),
        serde_json::json!({ "someFutureWrite": 1 }),
    ] {
        assert!(refused("runCommand", vec![command.clone()]), "{} should be refused", command);
    }
    assert_eq!(
        read_only_refusal("runCommand", &[serde_json::json!({ "createSearchIndexes": "users" })]).as_deref(),
        Some("the `createSearchIndexes` command")
    );
}

#[test]
fn a_command_that_is_not_a_document_is_refused() {
    assert!(refused("runCommand", vec![]));
    assert!(refused("runCommand", vec![serde_json::json!("ping")]));
    assert!(refused("runCommand", vec![serde_json::json!({})]));
}

#[test]
fn key_order_cannot_smuggle_a_write() {
    // The server runs whatever the first key names, and so does this check, but whether
    // the order survives here depends on a transitive `preserve_order` feature the crate
    // doesn't control. Build the document both ways round: refused either way.
    for (first, second) in [("insert", "documents"), ("documents", "insert")] {
        let mut map = serde_json::Map::new();
        map.insert(String::from(first), serde_json::json!("users"));
        map.insert(String::from(second), serde_json::json!([{ "a": 1 }]));
        let command = serde_json::Value::Object(map);
        assert!(refused("runCommand", vec![command]), "insert should be refused with {} first", first);
    }
}

#[test]
fn writing_pipelines_are_refused() {
    let out = serde_json::json!([{ "$match": {} }, { "$out": "copy" }]);
    let merge = serde_json::json!([{ "$merge": { "into": "copy" } }]);
    let read = serde_json::json!([{ "$match": {} }, { "$group": { "_id": null } }]);

    assert!(refused("aggregate", vec![out.clone()]));
    assert!(refused("aggregate", vec![merge]));
    assert!(!refused("aggregate", vec![read.clone()]));

    // …and the same pipeline smuggled through runCommand.
    assert!(refused("runCommand", vec![serde_json::json!({ "aggregate": "users", "pipeline": out })]));
    assert!(!refused("runCommand", vec![serde_json::json!({ "aggregate": "users", "pipeline": read })]));
}
