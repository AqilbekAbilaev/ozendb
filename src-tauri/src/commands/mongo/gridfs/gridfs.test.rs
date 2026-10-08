use super::{extract_buckets, extract_file};
use mongodb::bson::{doc, oid::ObjectId};

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[test]
fn extracts_default_fs_bucket() {
    let names = v(&["fs.files", "fs.chunks", "users"]);
    assert_eq!(extract_buckets(&names), vec!["fs".to_string()]);
}

#[test]
fn extracts_multiple_named_buckets_sorted() {
    let names = v(&["images.files", "images.chunks", "docs.files", "docs.chunks"]);
    assert_eq!(extract_buckets(&names), vec!["docs".to_string(), "images".to_string()]);
}

#[test]
fn ignores_chunks_and_plain_collections() {
    let names = v(&["fs.chunks", "orders", "products"]);
    assert!(extract_buckets(&names).is_empty());
}

#[test]
fn handles_bucket_names_with_dots() {
    let names = v(&["my.bucket.files", "my.bucket.chunks"]);
    assert_eq!(extract_buckets(&names), vec!["my.bucket".to_string()]);
}

#[test]
fn no_files_collection_means_no_buckets() {
    assert!(extract_buckets(&v(&[])).is_empty());
    assert!(extract_buckets(&v(&["a", "b.chunks"])).is_empty());
}

#[test]
fn deduplicates() {
    // Defensive: a name list shouldn't contain duplicates, but if it does the
    // bucket appears once.
    let names = v(&["fs.files", "fs.files"]);
    assert_eq!(extract_buckets(&names), vec!["fs".to_string()]);
}

#[test]
fn extract_file_reads_core_fields() {
    let oid = ObjectId::new();
    let d = doc! {
        "_id": oid,
        "filename": "photo.png",
        "length": 20480_i64,
        "contentType": "image/png",
    };
    let f = extract_file(&d);
    assert_eq!(f.id, oid.to_hex());
    assert_eq!(f.filename, "photo.png");
    assert_eq!(f.length, 20480);
    assert_eq!(f.content_type.as_deref(), Some("image/png"));
}

#[test]
fn extract_file_handles_missing_optional_fields() {
    let d = doc! { "_id": ObjectId::new(), "length": 5_i32 };
    let f = extract_file(&d);
    assert_eq!(f.filename, "(unnamed)");
    assert_eq!(f.length, 5);
    assert!(f.upload_date.is_none());
    assert!(f.content_type.is_none());
}

#[test]
fn extract_file_reads_length_from_double() {
    let d = doc! { "_id": ObjectId::new(), "length": 1024.0_f64 };
    assert_eq!(extract_file(&d).length, 1024);
}
