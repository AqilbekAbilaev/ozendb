/// A JSON array as Postgres's array input syntax — `{1,2}`, `{"a b",NULL}`,
/// `{{1,2},{3,4}}` — for binding behind a `$n::type[]` cast. Strings and objects are
/// always double-quoted with `\` and `"` escaped, so no element text can be read as
/// a separator, a brace or the NULL keyword.
pub(super) fn array_literal(items: &[serde_json::Value]) -> String {
    let elements: Vec<String> = items.iter().map(element).collect();
    format!("{{{}}}", elements.join(","))
}

fn element(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::from("NULL"),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Array(items) => array_literal(items),
        serde_json::Value::String(s) => quoted(s),
        serde_json::Value::Object(_) => quoted(&value.to_string()),
    }
}

fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}
