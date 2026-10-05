use super::sql_to_mql;
use serde_json::Value;

// Parse a produced JSON string back into a Value so filter assertions are
// independent of key ordering and whitespace. (Sort order is checked separately
// on the raw string, since sort key order is semantically significant.)
fn json(s: &str) -> Value {
    serde_json::from_str(s).expect("produced output should be valid JSON")
}

fn ok(sql: &str) -> super::MqlQuery {
    match sql_to_mql(sql) {
        Ok(val) => val,
        Err(e) => panic!("expected {sql:?} to translate, got error: {e}"),
    }
}

#[test]
fn select_star() {
    let q = ok("SELECT * FROM users");
    assert_eq!(q.collection, "users");
    assert_eq!(json(&q.filter), serde_json::json!({}));
    assert_eq!(json(&q.projection), serde_json::json!({}));
    assert_eq!(json(&q.sort), serde_json::json!({}));
    assert_eq!(q.limit, None);
    assert_eq!(q.skip, None);
}

#[test]
fn projection_columns() {
    let q = ok("SELECT name, age FROM users");
    assert_eq!(json(&q.projection), serde_json::json!({ "name": 1, "age": 1 }));
}

#[test]
fn projection_ignores_alias() {
    let q = ok("SELECT name AS n FROM users");
    assert_eq!(json(&q.projection), serde_json::json!({ "name": 1 }));
}

#[test]
fn equality_filter() {
    let q = ok("SELECT * FROM users WHERE age = 21");
    assert_eq!(json(&q.filter), serde_json::json!({ "age": 21 }));
}

#[test]
fn string_equality() {
    let q = ok("SELECT * FROM users WHERE name = 'John'");
    assert_eq!(json(&q.filter), serde_json::json!({ "name": "John" }));
}

#[test]
fn comparison_operators() {
    assert_eq!(json(&ok("SELECT * FROM t WHERE a >= 18").filter), serde_json::json!({ "a": { "$gte": 18 } }));
    assert_eq!(json(&ok("SELECT * FROM t WHERE a != 5").filter), serde_json::json!({ "a": { "$ne": 5 } }));
    assert_eq!(json(&ok("SELECT * FROM t WHERE a <> 5").filter), serde_json::json!({ "a": { "$ne": 5 } }));
    assert_eq!(json(&ok("SELECT * FROM t WHERE a < 5").filter), serde_json::json!({ "a": { "$lt": 5 } }));
}

#[test]
fn negative_number() {
    let q = ok("SELECT * FROM t WHERE balance < -50");
    assert_eq!(json(&q.filter), serde_json::json!({ "balance": { "$lt": -50 } }));
}

#[test]
fn float_value() {
    let q = ok("SELECT * FROM t WHERE score > 3.5");
    assert_eq!(json(&q.filter), serde_json::json!({ "score": { "$gt": 3.5 } }));
}

#[test]
fn boolean_value() {
    let q = ok("SELECT * FROM t WHERE active = true");
    assert_eq!(json(&q.filter), serde_json::json!({ "active": true }));
}

#[test]
fn and_distinct_fields_merges() {
    let q = ok("SELECT * FROM t WHERE age >= 18 AND active = true");
    assert_eq!(json(&q.filter), serde_json::json!({ "age": { "$gte": 18 }, "active": true }));
}

#[test]
fn and_same_field_uses_and_array() {
    let q = ok("SELECT * FROM t WHERE age > 1 AND age < 10");
    assert_eq!(
        json(&q.filter),
        serde_json::json!({ "$and": [ { "age": { "$gt": 1 } }, { "age": { "$lt": 10 } } ] })
    );
}

#[test]
fn or_expression() {
    let q = ok("SELECT * FROM t WHERE a = 1 OR b = 2");
    assert_eq!(json(&q.filter), serde_json::json!({ "$or": [ { "a": 1 }, { "b": 2 } ] }));
}

#[test]
fn and_binds_tighter_than_or() {
    let q = ok("SELECT * FROM t WHERE a = 1 AND b = 2 OR c = 3");
    assert_eq!(
        json(&q.filter),
        serde_json::json!({ "$or": [ { "a": 1, "b": 2 }, { "c": 3 } ] })
    );
}

#[test]
fn parentheses_override_precedence() {
    let q = ok("SELECT * FROM t WHERE (a = 1 OR b = 2) AND c = 3");
    assert_eq!(
        json(&q.filter),
        serde_json::json!({ "$or": [ { "a": 1 }, { "b": 2 } ], "c": 3 })
    );
}

#[test]
fn like_becomes_anchored_regex() {
    let q = ok("SELECT * FROM t WHERE name LIKE 'jo%'");
    assert_eq!(json(&q.filter), serde_json::json!({ "name": { "$regex": "^jo.*$" } }));
}

#[test]
fn like_underscore_maps_to_dot_and_escapes_meta() {
    let q = ok("SELECT * FROM t WHERE code LIKE 'a_.c%'");
    assert_eq!(json(&q.filter), serde_json::json!({ "code": { "$regex": "^a.\\.c.*$" } }));
}

#[test]
fn not_like() {
    let q = ok("SELECT * FROM t WHERE name NOT LIKE 'x%'");
    assert_eq!(
        json(&q.filter),
        serde_json::json!({ "name": { "$not": { "$regex": "^x.*$" } } })
    );
}

#[test]
fn in_list() {
    let q = ok("SELECT * FROM t WHERE status IN ('a', 'b', 'c')");
    assert_eq!(json(&q.filter), serde_json::json!({ "status": { "$in": ["a", "b", "c"] } }));
}

#[test]
fn not_in_list() {
    let q = ok("SELECT * FROM t WHERE n NOT IN (1, 2)");
    assert_eq!(json(&q.filter), serde_json::json!({ "n": { "$nin": [1, 2] } }));
}

#[test]
fn is_null_and_is_not_null() {
    assert_eq!(json(&ok("SELECT * FROM t WHERE x IS NULL").filter), serde_json::json!({ "x": null }));
    assert_eq!(
        json(&ok("SELECT * FROM t WHERE x IS NOT NULL").filter),
        serde_json::json!({ "x": { "$ne": null } })
    );
}

#[test]
fn between() {
    let q = ok("SELECT * FROM t WHERE age BETWEEN 18 AND 65");
    assert_eq!(json(&q.filter), serde_json::json!({ "age": { "$gte": 18, "$lte": 65 } }));
}

#[test]
fn order_by_preserves_key_order() {
    let q = ok("SELECT * FROM t ORDER BY b DESC, a");
    // Sort key order is significant, so assert the exact emitted string.
    assert_eq!(q.sort, "{\n  \"b\": -1,\n  \"a\": 1\n}");
}

#[test]
fn limit_and_offset() {
    let q = ok("SELECT * FROM t LIMIT 10 OFFSET 5");
    assert_eq!(q.limit, Some(10));
    assert_eq!(q.skip, Some(5));
}

#[test]
fn skip_is_an_alias_for_offset() {
    let q = ok("SELECT * FROM t LIMIT 3 SKIP 7");
    assert_eq!(q.limit, Some(3));
    assert_eq!(q.skip, Some(7));
}

#[test]
fn trailing_semicolon_is_accepted() {
    let q = ok("SELECT * FROM users;");
    assert_eq!(q.collection, "users");
}

#[test]
fn case_insensitive_keywords() {
    let q = ok("select * from users where age = 1 order by age desc limit 2");
    assert_eq!(q.collection, "users");
    assert_eq!(q.limit, Some(2));
}

#[test]
fn dotted_field_path() {
    let q = ok("SELECT * FROM t WHERE address.city = 'NYC'");
    assert_eq!(json(&q.filter), serde_json::json!({ "address.city": "NYC" }));
}

// ── Error cases ──
#[test]
fn missing_select() {
    assert!(sql_to_mql("FROM users").is_err());
}

#[test]
fn missing_from() {
    assert!(sql_to_mql("SELECT *").is_err());
}

#[test]
fn aggregate_function_is_rejected() {
    let err = sql_to_mql("SELECT COUNT(*) FROM t").unwrap_err();
    assert!(err.to_lowercase().contains("not supported"));
}

#[test]
fn unterminated_string_errors() {
    assert!(sql_to_mql("SELECT * FROM t WHERE name = 'oops").is_err());
}

#[test]
fn empty_in_list_errors() {
    assert!(sql_to_mql("SELECT * FROM t WHERE x IN ()").is_err());
}

#[test]
fn trailing_garbage_errors() {
    assert!(sql_to_mql("SELECT * FROM t garbage").is_err());
}
