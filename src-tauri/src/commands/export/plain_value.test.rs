use super::*;

#[test]
fn object_id_renders_as_plain_hex() {
    let oid = bson::oid::ObjectId::parse_str("5f8d0d55b54764421b7156c3").unwrap();
    assert_eq!(bson_to_plain_cell(&bson::Bson::ObjectId(oid)), "5f8d0d55b54764421b7156c3");
}

#[test]
fn datetime_renders_as_iso_8601_text() {
    // 2024-03-07T09:15:30Z, chosen to include a non-zero time-of-day so a truncation
    // bug (e.g. dropping the time) would be caught.
    let dt = bson::DateTime::from_millis(1709802930000);
    assert_eq!(bson_to_plain_cell(&bson::Bson::DateTime(dt)), "2024-03-07T09:15:30Z");
}

#[test]
fn datetime_outside_rfc3339_range_falls_back_to_extended_json() {
    // Year 10000 has no four-digit RFC 3339 representation.
    let dt = bson::DateTime::from_millis(253_402_300_800_000);
    let cell = bson_to_plain_cell(&bson::Bson::DateTime(dt));
    assert!(cell.contains("$date"), "expected an Extended JSON fallback, got {cell}");
}

#[test]
fn decimal128_renders_its_number_text_not_a_wrapper() {
    let decimal: bson::Decimal128 = "19.99".parse().unwrap();
    assert_eq!(bson_to_plain_cell(&bson::Bson::Decimal128(decimal)), "19.99");
}

#[test]
fn null_renders_as_an_empty_cell() {
    assert_eq!(bson_to_plain_cell(&bson::Bson::Null), "");
}

#[test]
fn scalars_render_unchanged() {
    assert_eq!(bson_to_plain_cell(&bson::Bson::String("côte d'Ivoire".to_string())), "côte d'Ivoire");
    assert_eq!(bson_to_plain_cell(&bson::Bson::Boolean(true)), "true");
    assert_eq!(bson_to_plain_cell(&bson::Bson::Int32(-7)), "-7");
    assert_eq!(bson_to_plain_cell(&bson::Bson::Int64(9_000_000_000)), "9000000000");
    assert_eq!(bson_to_plain_cell(&bson::Bson::Double(3.5)), "3.5");
}

#[test]
fn nested_document_falls_back_to_json() {
    let doc = bson::doc! { "street": "Rue de l'Église", "no": 12 };
    let cell = bson_to_plain_cell(&bson::Bson::Document(doc));
    let parsed: serde_json::Value = serde_json::from_str(&cell).unwrap();
    assert_eq!(parsed["street"], serde_json::json!("Rue de l'Église"));
}

#[test]
fn array_falls_back_to_json() {
    let cell = bson_to_plain_cell(&bson::bson!(["a", "b", "c"]));
    assert_eq!(cell, r#"["a","b","c"]"#);
}

#[test]
fn excel_datetime_converts_within_range() {
    let dt = bson::DateTime::from_millis(1709802930000);
    assert!(excel_datetime(dt).is_ok());
}

#[test]
fn excel_datetime_rejects_a_year_beyond_excels_range() {
    // Excel's upper bound is year 9999; year 10000 must be a typed error, not a panic.
    let dt = bson::DateTime::from_millis(253_402_300_800_000);
    assert!(matches!(
        excel_datetime(dt),
        Err(rust_xlsxwriter::XlsxError::DateTimeRangeError(_))
    ));
}
