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

#[test]
fn is_write_method_flags_mutations() {
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
        assert!(is_write_method(method), "{} should be a write", method);
    }
}

#[test]
fn is_write_method_allows_reads() {
    for method in [
        "find",
        "findOne",
        "aggregate",
        "countDocuments",
        "distinct",
        "estimatedDocumentCount",
    ] {
        assert!(!is_write_method(method), "{} should be a read", method);
    }
}

#[test]
fn is_write_method_rejects_unknown() {
    assert!(!is_write_method("bogusMethod"));
}

// ── read-only guard: runCommand and writing pipelines ──────────────────────

fn args(values: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    values
}

#[test]
fn op_writes_flags_write_methods() {
    assert!(op_writes("deleteMany", &args(vec![])));
    assert!(op_writes("drop", &args(vec![])));
}

#[test]
fn op_writes_allows_plain_reads() {
    assert!(!op_writes("find", &args(vec![serde_json::json!({})])));
    assert!(!op_writes("countDocuments", &args(vec![])));
    assert!(!op_writes("runCommand", &args(vec![serde_json::json!({ "listCollections": 1 })])));
    assert!(!op_writes("runCommand", &args(vec![serde_json::json!({ "collStats": "users" })])));
}

#[test]
fn op_writes_catches_run_command_writes() {
    for command in [
        serde_json::json!({ "drop": "users" }),
        serde_json::json!({ "dropDatabase": 1 }),
        serde_json::json!({ "createUser": "bob", "pwd": "x" }),
        serde_json::json!({ "renameCollection": "a.b", "to": "a.c" }),
        serde_json::json!({ "collMod": "users" }),
    ] {
        assert!(
            op_writes("runCommand", &args(vec![command.clone()])),
            "{} should be refused",
            command
        );
    }
}

#[test]
fn op_writes_is_not_fooled_by_key_order() {
    // The command name is only "first" by MongoDB convention, and whether that
    // survives serialization here depends on a transitive `preserve_order` feature
    // the crate doesn't control. Build the document both ways round and require the
    // guard to catch it either way.
    for (first, second) in [("insert", "documents"), ("documents", "insert")] {
        let mut map = serde_json::Map::new();
        map.insert(String::from(first), serde_json::json!("users"));
        map.insert(String::from(second), serde_json::json!([{ "a": 1 }]));
        let command = serde_json::Value::Object(map);
        assert!(
            op_writes("runCommand", &args(vec![command])),
            "insert should be refused with {} first",
            first
        );
    }
}

#[test]
fn op_writes_catches_writing_pipelines() {
    let out = serde_json::json!([{ "$match": {} }, { "$out": "copy" }]);
    let merge = serde_json::json!([{ "$merge": { "into": "copy" } }]);
    let read = serde_json::json!([{ "$match": {} }, { "$group": { "_id": null } }]);

    assert!(op_writes("aggregate", &args(vec![out.clone()])));
    assert!(op_writes("aggregate", &args(vec![merge])));
    assert!(!op_writes("aggregate", &args(vec![read.clone()])));

    // …and the same pipeline smuggled through runCommand.
    assert!(op_writes(
        "runCommand",
        &args(vec![serde_json::json!({ "aggregate": "users", "pipeline": out })])
    ));
    assert!(!op_writes(
        "runCommand",
        &args(vec![serde_json::json!({ "aggregate": "users", "pipeline": read })])
    ));
}
