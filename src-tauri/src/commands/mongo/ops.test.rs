use super::opid_to_bson;
use mongodb::bson;

// killOp matches the opid by type: a mongod opid that arrives as a Double matches
// nothing, and the kill silently succeeds while the operation keeps running.
#[test]
fn a_numeric_opid_stays_an_integer() {
    let opid = serde_json::json!(1380004_i64);
    assert_eq!(opid_to_bson(&opid).unwrap(), bson::Bson::Int64(1380004));
}

// mongos reports "shard0000:1234" instead of a number, and killOp takes it verbatim.
#[test]
fn a_sharded_opid_stays_a_string() {
    let opid = serde_json::json!("shard0000:1234");
    assert_eq!(
        opid_to_bson(&opid).unwrap(),
        bson::Bson::String("shard0000:1234".to_string())
    );
}

#[test]
fn anything_else_is_refused_rather_than_guessed() {
    assert!(opid_to_bson(&serde_json::json!(3.5)).is_err());
    assert!(opid_to_bson(&serde_json::json!(null)).is_err());
    assert!(opid_to_bson(&serde_json::json!({ "op": 1 })).is_err());
}
