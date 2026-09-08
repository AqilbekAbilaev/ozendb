use super::*;
use mongodb::bson;

#[test]
fn coerce_string_from_number_and_bool() {
    assert_eq!(
        coerce(bson::Bson::Int64(42), "string"),
        bson::Bson::String("42".to_string())
    );
    assert_eq!(
        coerce(bson::Bson::Boolean(true), "string"),
        bson::Bson::String("true".to_string())
    );
}

#[test]
fn coerce_int_parses_and_truncates() {
    assert_eq!(
        coerce(bson::Bson::String("17".to_string()), "int"),
        bson::Bson::Int32(17)
    );
    // A float string truncates toward zero.
    assert_eq!(
        coerce(bson::Bson::String("3.9".to_string()), "int"),
        bson::Bson::Int32(3)
    );
    assert_eq!(coerce(bson::Bson::Double(9.7), "int"), bson::Bson::Int32(9));
}

#[test]
fn coerce_long_and_double() {
    assert_eq!(
        coerce(bson::Bson::String("9000000000".to_string()), "long"),
        bson::Bson::Int64(9_000_000_000)
    );
    assert_eq!(
        coerce(bson::Bson::String("2.5".to_string()), "double"),
        bson::Bson::Double(2.5)
    );
    assert_eq!(
        coerce(bson::Bson::Int32(4), "double"),
        bson::Bson::Double(4.0)
    );
}

#[test]
fn coerce_bool_from_strings() {
    assert_eq!(
        coerce(bson::Bson::String("Yes".to_string()), "bool"),
        bson::Bson::Boolean(true)
    );
    assert_eq!(
        coerce(bson::Bson::String("0".to_string()), "bool"),
        bson::Bson::Boolean(false)
    );
    assert_eq!(coerce(bson::Bson::Int32(3), "bool"), bson::Bson::Boolean(true));
}

#[test]
fn coerce_date_from_string_and_millis() {
    match coerce(bson::Bson::String("2020-01-01T00:00:00Z".to_string()), "date") {
        bson::Bson::DateTime(_) => {}
        other => panic!("expected a date, got {:?}", other),
    }
    match coerce(bson::Bson::Int64(1_577_836_800_000), "date") {
        bson::Bson::DateTime(_) => {}
        other => panic!("expected a date, got {:?}", other),
    }
}

#[test]
fn coerce_object_id_from_hex() {
    match coerce(
        bson::Bson::String("507f1f77bcf86cd799439011".to_string()),
        "objectId",
    ) {
        bson::Bson::ObjectId(_) => {}
        other => panic!("expected an ObjectId, got {:?}", other),
    }
}

#[test]
fn coerce_keeps_bad_input_unchanged() {
    // Non-numeric string as int → original string, not dropped.
    assert_eq!(
        coerce(bson::Bson::String("abc".to_string()), "int"),
        bson::Bson::String("abc".to_string())
    );
    // Non-hex string as objectId → original string.
    assert_eq!(
        coerce(bson::Bson::String("nope".to_string()), "objectId"),
        bson::Bson::String("nope".to_string())
    );
    // Unparseable date string → original string.
    assert_eq!(
        coerce(bson::Bson::String("not-a-date".to_string()), "date"),
        bson::Bson::String("not-a-date".to_string())
    );
}

#[test]
fn coerce_null_stays_null_for_every_kind() {
    for kind in ["string", "int", "long", "double", "bool", "date", "objectId"] {
        assert_eq!(coerce(bson::Bson::Null, kind), bson::Bson::Null);
    }
}

#[test]
fn coerce_auto_and_unknown_pass_through() {
    assert_eq!(
        coerce(bson::Bson::Int32(5), "auto"),
        bson::Bson::Int32(5)
    );
    assert_eq!(
        coerce(bson::Bson::Int32(5), "somethingelse"),
        bson::Bson::Int32(5)
    );
}

#[test]
fn apply_field_map_renames_selects_and_coerces() {
    let doc = bson::doc! { "name": "Ann", "age": "30", "extra": "drop me" };
    let mapping = vec![
        FieldMap {
            source: "name".to_string(),
            target: "fullName".to_string(),
            kind: "string".to_string(),
        },
        FieldMap {
            source: "age".to_string(),
            target: "age".to_string(),
            kind: "int".to_string(),
        },
        // Empty target drops the column.
        FieldMap {
            source: "extra".to_string(),
            target: "".to_string(),
            kind: "auto".to_string(),
        },
    ];
    let out = apply_field_map(&doc, &mapping);
    assert_eq!(out.get("fullName"), Some(&bson::Bson::String("Ann".to_string())));
    assert_eq!(out.get("age"), Some(&bson::Bson::Int32(30)));
    assert!(out.get("extra").is_none());
    // Output holds exactly the two mapped fields.
    assert_eq!(out.len(), 2);
}

#[test]
fn apply_field_map_skips_missing_source() {
    let doc = bson::doc! { "a": 1 };
    let mapping = vec![FieldMap {
        source: "missing".to_string(),
        target: "x".to_string(),
        kind: "string".to_string(),
    }];
    let out = apply_field_map(&doc, &mapping);
    assert!(out.is_empty());
}
