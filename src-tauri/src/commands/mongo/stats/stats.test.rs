use super::extract_stats;
use mongodb::bson::doc;

#[test]
fn extracts_headline_numbers() {
    let raw = doc! {
        "ns": "app.users",
        "count": 1200_i64,
        "size": 480000_i64,
        "avgObjSize": 400_i32,
        "storageSize": 512000_i64,
        "nindexes": 2_i32,
        "totalIndexSize": 81920_i64,
        "capped": false,
    };
    let s = extract_stats(&raw);
    assert_eq!(s.ns.as_deref(), Some("app.users"));
    assert_eq!(s.count, Some(1200));
    assert_eq!(s.size, Some(480000));
    assert_eq!(s.avg_obj_size, Some(400));
    assert_eq!(s.storage_size, Some(512000));
    assert_eq!(s.nindexes, Some(2));
    assert_eq!(s.total_index_size, Some(81920));
    assert!(!s.capped);
}

#[test]
fn reads_numbers_regardless_of_bson_number_type() {
    // collStats may return Double for large values; still read as i64.
    let raw = doc! { "count": 5.0_f64, "size": 100_i32, "storageSize": 2048_i64 };
    let s = extract_stats(&raw);
    assert_eq!(s.count, Some(5));
    assert_eq!(s.size, Some(100));
    assert_eq!(s.storage_size, Some(2048));
}

#[test]
fn index_sizes_sorted_largest_first() {
    let raw = doc! {
        "indexSizes": { "_id_": 4096_i32, "email_1": 20480_i32, "name_1": 8192_i32 },
    };
    let s = extract_stats(&raw);
    let names: Vec<&str> = s.indexes.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(names, vec!["email_1", "name_1", "_id_"]);
    assert_eq!(s.indexes[0].size, 20480);
}

#[test]
fn missing_fields_are_none_not_zero() {
    let raw = doc! { "ns": "app.empty" };
    let s = extract_stats(&raw);
    assert_eq!(s.count, None);
    assert_eq!(s.size, None);
    assert_eq!(s.avg_obj_size, None);
    assert!(s.indexes.is_empty());
    assert!(!s.capped);
}

#[test]
fn capped_flag_is_read() {
    let raw = doc! { "ns": "app.logs", "capped": true };
    let s = extract_stats(&raw);
    assert!(s.capped);
}

#[test]
fn raw_document_is_preserved() {
    let raw = doc! { "ns": "app.users", "count": 3_i32 };
    let s = extract_stats(&raw);
    assert_eq!(s.raw["ns"], serde_json::json!("app.users"));
    assert_eq!(s.raw["count"], serde_json::json!(3));
}
