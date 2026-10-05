use super::{collect, Matcher, Scope};
use mongodb::bson::{doc, Bson};

// Helper: run the walk over a document and return the (path, value) rows.
fn find(d: &mongodb::bson::Document, matcher: &Matcher, scope: &Scope) -> Vec<(String, String)> {
    let mut out = Vec::new();
    collect(&Bson::Document(d.clone()), "", matcher, scope, &mut out);
    out
}

// Case-insensitive substring over both value and name.
fn ci(needle: &str) -> Matcher {
    Matcher::Substr { needle: needle.to_lowercase(), case_sensitive: false }
}
fn both() -> Scope {
    Scope { values: true, names: true }
}
fn values_only() -> Scope {
    Scope { values: true, names: false }
}
fn names_only() -> Scope {
    Scope { values: false, names: true }
}

fn paths(rows: &[(String, String)]) -> Vec<&str> {
    rows.iter().map(|(p, _)| p.as_str()).collect()
}

#[test]
fn matches_string_value_case_insensitively() {
    let d = doc! { "name": "Alice Smith" };
    let rows = find(&d, &ci("alice"), &values_only());
    assert_eq!(rows, vec![("name".to_string(), "Alice Smith".to_string())]);
    assert!(find(&d, &ci("bob"), &values_only()).is_empty());
}

#[test]
fn matches_substring() {
    let d = doc! { "email": "person@example.com" };
    assert_eq!(paths(&find(&d, &ci("example"), &values_only())), vec!["email"]);
    assert_eq!(paths(&find(&d, &ci("@example.com"), &values_only())), vec!["email"]);
}

#[test]
fn matches_numeric_text() {
    let d = doc! { "age": 42_i32, "score": 3.14_f64 };
    assert_eq!(paths(&find(&d, &ci("42"), &values_only())), vec!["age"]);
    assert_eq!(paths(&find(&d, &ci("3.14"), &values_only())), vec!["score"]);
    assert!(find(&d, &ci("99"), &values_only()).is_empty());
}

#[test]
fn recurses_into_nested_documents_with_dotted_path() {
    let d = doc! { "address": { "city": "Portland" } };
    let rows = find(&d, &ci("portland"), &values_only());
    assert_eq!(rows, vec![("address.city".to_string(), "Portland".to_string())]);
}

#[test]
fn recurses_into_arrays_with_indexed_path() {
    let d = doc! { "tags": ["red", "green", "blue"] };
    let rows = find(&d, &ci("green"), &values_only());
    assert_eq!(rows, vec![("tags.1".to_string(), "green".to_string())]);
    assert!(find(&d, &ci("purple"), &values_only()).is_empty());
}

#[test]
fn recurses_into_array_of_documents() {
    let d = doc! { "items": [ { "sku": "ABC" }, { "sku": "XYZ" } ] };
    let rows = find(&d, &ci("xyz"), &values_only());
    assert_eq!(rows, vec![("items.1.sku".to_string(), "XYZ".to_string())]);
}

#[test]
fn matches_objectid_hex() {
    let oid = mongodb::bson::oid::ObjectId::new();
    let hex = oid.to_hex();
    let d = doc! { "_id": oid };
    assert_eq!(paths(&find(&d, &ci(&hex[..8]), &values_only())), vec!["_id"]);
}

#[test]
fn name_scope_matches_field_names() {
    let d = doc! { "username": "carol", "role": "admin" };
    // "name" appears in the key "username", not in any value.
    let rows = find(&d, &ci("name"), &names_only());
    assert_eq!(rows, vec![("username".to_string(), "carol".to_string())]);
    assert!(find(&d, &ci("name"), &values_only()).is_empty());
}

#[test]
fn both_scope_reports_name_and_value_separately() {
    // The key "tag" and the value "tag" both match — two rows.
    let d = doc! { "tag": "tagged" };
    let rows = find(&d, &ci("tag"), &both());
    assert_eq!(rows.len(), 2);
    assert!(rows.contains(&("tag".to_string(), "tagged".to_string())));
}

#[test]
fn case_sensitive_substring_respects_case() {
    let d = doc! { "name": "Alice" };
    let cs = Matcher::Substr { needle: "alice".to_string(), case_sensitive: true };
    assert!(find(&d, &cs, &values_only()).is_empty());
    let cs2 = Matcher::Substr { needle: "Alice".to_string(), case_sensitive: true };
    assert_eq!(paths(&find(&d, &cs2, &values_only())), vec!["name"]);
}

#[test]
fn regex_matcher_matches_pattern() {
    let d = doc! { "code": "AB-123", "note": "no digits here" };
    let re = Matcher::Regex(regex::Regex::new(r"\d{3}").unwrap());
    assert_eq!(paths(&find(&d, &re, &values_only())), vec!["code"]);
}
