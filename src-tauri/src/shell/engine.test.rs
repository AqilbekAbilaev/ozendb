use super::*;

// These exercise plain JS evaluation through boa, with no live MongoDB and no
// tokio runtime: `new_session()` / `eval_in()` need neither. The `db` bridge
// itself is covered in `bridge.test.rs`.

#[test]
fn arithmetic_evaluates_to_a_plain_number() {
    let mut session = new_session();
    let result = eval_in(&mut session.context, "1 + 1");
    assert_eq!(result.value, Some(serde_json::json!(2)));
    assert_eq!(result.error, None);
}

#[test]
fn a_string_method_runs_through_the_stdlib() {
    let mut session = new_session();
    let result = eval_in(&mut session.context, "'ab'.toUpperCase()");
    assert_eq!(result.value, Some(serde_json::json!("AB")));
}

#[test]
fn json_stringify_and_parse_round_trip() {
    let mut session = new_session();
    let result = eval_in(
        &mut session.context,
        "JSON.parse(JSON.stringify({ a: 1, b: [2, 3] }))",
    );
    assert_eq!(result.value, Some(serde_json::json!({ "a": 1, "b": [2, 3] })));
}

#[test]
fn print_joins_args_with_a_space_and_stringifies_non_strings() {
    let mut session = new_session();
    let result = eval_in(&mut session.context, "print('a', 1)");
    assert_eq!(result.logs, vec![String::from("a 1")]);
}

#[test]
fn printjson_pretty_prints() {
    let mut session = new_session();
    let result = eval_in(&mut session.context, "printjson({ a: 1 })");
    assert_eq!(result.logs, vec![String::from("{\n  \"a\": 1\n}")]);
}

#[test]
fn logs_reset_between_submissions() {
    let mut session = new_session();
    let first = eval_in(&mut session.context, "print('one')");
    assert_eq!(first.logs, vec![String::from("one")]);

    let second = eval_in(&mut session.context, "1");
    assert!(second.logs.is_empty(), "second submission should not inherit the first's logs");
}

#[test]
fn variables_persist_across_submissions_in_the_same_context() {
    let mut session = new_session();
    let first = eval_in(&mut session.context, "var x = 5;");
    assert_eq!(first.error, None);

    let second = eval_in(&mut session.context, "x");
    assert_eq!(second.value, Some(serde_json::json!(5)));
}

#[test]
fn a_thrown_error_is_reported_not_panicked() {
    let mut session = new_session();
    let result = eval_in(&mut session.context, "throw new Error('boom')");
    assert_eq!(result.value, None);
    let message = result.error.expect("expected an error");
    assert!(message.contains("boom"), "error message was: {}", message);
}

#[test]
fn a_syntax_error_fails_as_an_error() {
    let mut session = new_session();
    let result = eval_in(&mut session.context, "function (");
    assert_eq!(result.value, None);
    assert!(result.error.is_some());
}

#[test]
fn undefined_completion_value_is_none() {
    let mut session = new_session();
    let result = eval_in(&mut session.context, "undefined");
    assert_eq!(result.value, None);
    assert_eq!(result.error, None);
}

#[test]
fn materialize_cursor_calls_to_array_on_a_tagged_object() {
    let mut session = new_session();
    // No driver involved: a plain JS object tagged `__isCursor` with a
    // `toArray()` method stands in for a real shell cursor.
    let result = eval_in(
        &mut session.context,
        "({ __isCursor: true, toArray: function () { return [1, 2, 3]; } })",
    );
    assert_eq!(result.value, Some(serde_json::json!([1, 2, 3])));
}

#[test]
fn a_plain_object_without_the_cursor_tag_is_returned_untouched() {
    let mut session = new_session();
    let result = eval_in(&mut session.context, "({ a: 1 })");
    assert_eq!(result.value, Some(serde_json::json!({ "a": 1 })));
}

#[test]
fn infinite_recursion_is_caught_by_the_recursion_limit_not_a_hang() {
    let mut session = new_session();
    let result = eval_in(&mut session.context, "function f() { return f(); } f();");
    assert_eq!(result.value, None);
    let message = result.error.expect("runaway recursion should surface as an error");
    assert!(
        message.contains("RuntimeLimitError"),
        "expected the recursion limit to fire, got: {}",
        message
    );
}
