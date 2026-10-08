use super::is_operator_update;
use mongodb::bson::doc;

#[test]
fn operator_form_updates_are_accepted() {
    assert!(is_operator_update(&doc! { "$set": { "a": 1 } }));
    assert!(is_operator_update(&doc! { "$set": { "a": 1 }, "$unset": { "b": "" } }));
}

#[test]
fn replacement_and_empty_updates_are_rejected() {
    // A plain field is replacement-style, which update_many must not accept.
    assert!(!is_operator_update(&doc! { "a": 1 }));
    // Mixed operator + field is also invalid.
    assert!(!is_operator_update(&doc! { "$set": { "a": 1 }, "b": 2 }));
    // An empty update changes nothing and is not valid operator form.
    assert!(!is_operator_update(&doc! {}));
}
