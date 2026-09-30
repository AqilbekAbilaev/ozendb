use super::stringify_param;
use serde_json::json;

#[test]
fn stringify_renders_scalars_as_plain_text() {
    assert_eq!(stringify_param(&json!(true), "boolean"), Some(String::from("true")));
    assert_eq!(stringify_param(&json!(42), "integer"), Some(String::from("42")));
    assert_eq!(stringify_param(&json!(3.5), "double precision"), Some(String::from("3.5")));
    assert_eq!(stringify_param(&json!("hello"), "text"), Some(String::from("hello")));
}

#[test]
fn stringify_renders_null_as_a_real_sql_null() {
    assert_eq!(stringify_param(&serde_json::Value::Null, "text"), None);
    assert_eq!(stringify_param(&serde_json::Value::Null, "jsonb"), None);
}

#[test]
fn stringify_renders_containers_as_json_text() {
    assert_eq!(stringify_param(&json!({"a": 1}), "jsonb"), Some(String::from("{\"a\":1}")));

}

#[test]
fn stringify_always_quotes_json_and_jsonb_strings() {
    // A JSON string value must reach Postgres as `"hi"` (quotes included) for a
    // json/jsonb column — the bare text `hi` isn't valid JSON input at all, so
    // the update would otherwise fail (or, for a differently-typed column,
    // silently store the wrong thing).
    assert_eq!(stringify_param(&json!("hi"), "json"), Some(String::from("\"hi\"")));
    assert_eq!(stringify_param(&json!("hi"), "jsonb"), Some(String::from("\"hi\"")));
    assert_eq!(stringify_param(&json!(42), "jsonb"), Some(String::from("42")));
}

#[test]
fn stringify_renders_arrays_as_postgres_array_literals() {
    assert_eq!(stringify_param(&json!([1, 2.5]), "numeric[]"), Some(String::from("{1,2.5}")));
    assert_eq!(stringify_param(&json!(["a b", "c\"d", "e\\f", null]), "text[]"), Some(String::from(r#"{"a b","c\"d","e\\f",NULL}"#)));
    assert_eq!(stringify_param(&json!([[1, 2], [3, 4]]), "integer[]"), Some(String::from("{{1,2},{3,4}}")));
    assert_eq!(stringify_param(&json!([true]), "boolean[]"), Some(String::from("{true}")));
    assert_eq!(stringify_param(&json!([{"a": 1}]), "jsonb[]"), Some(String::from(r#"{"{\"a\":1}"}"#)));
    assert_eq!(stringify_param(&json!([]), "text[]"), Some(String::from("{}")));
}
