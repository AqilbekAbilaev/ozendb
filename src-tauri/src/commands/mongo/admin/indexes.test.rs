use super::*;
use mongodb::bson::doc;

// #237: a raw `createIndexes` command requires `name` in every spec, unlike the
// driver's typed index builder which fills it in. These pin down the name MongoDB
// itself would generate, so `create_index` can supply one before sending the command.

#[test]
fn single_ascending_key() {
    assert_eq!(default_index_name(&doc! { "a": 1 }), "a_1");
}

#[test]
fn multiple_keys_mixed_directions() {
    assert_eq!(default_index_name(&doc! { "a": 1, "b": -1 }), "a_1_b_-1");
}

#[test]
fn dotted_field_path_is_used_as_written() {
    assert_eq!(default_index_name(&doc! { "a.b": 1 }), "a.b_1");
}

#[test]
fn twodsphere_key_type() {
    assert_eq!(default_index_name(&doc! { "loc": "2dsphere" }), "loc_2dsphere");
}

#[test]
fn text_key_type() {
    assert_eq!(default_index_name(&doc! { "subject": "text" }), "subject_text");
}

#[test]
fn hashed_key_type() {
    assert_eq!(default_index_name(&doc! { "a": "hashed" }), "a_hashed");
}

// JSON has no int/float distinction, so a direction can arrive as a Double (e.g. from
// the JSON escape-hatch tab); it must still render as `1`, not `1.0`.
#[test]
fn double_typed_direction_renders_as_integer() {
    assert_eq!(default_index_name(&doc! { "a": 1.0 }), "a_1");
    assert_eq!(default_index_name(&doc! { "a": -1.0 }), "a_-1");
}

#[test]
fn explicit_name_is_preserved_not_overwritten() {
    let options = doc! { "name": "custom_name" };
    assert_eq!(resolved_index_name(&options, &doc! { "a": 1 }), "custom_name");
}

#[test]
fn blank_name_falls_back_to_the_default() {
    let options = doc! { "name": "" };
    assert_eq!(resolved_index_name(&options, &doc! { "a": 1 }), "a_1");
}

#[test]
fn missing_name_falls_back_to_the_default() {
    let options = doc! {};
    assert_eq!(resolved_index_name(&options, &doc! { "a": 1, "b": -1 }), "a_1_b_-1");
}
