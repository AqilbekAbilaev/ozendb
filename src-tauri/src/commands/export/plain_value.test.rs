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

#[test]
fn excel_datetime_floors_a_pre_1970_timestamp_instead_of_rounding_toward_zero() {
    // -1500 ms is 1.5s before the epoch. Flooring (div_euclid) lands on -2s
    // (1969-12-31T23:59:58Z); truncating division (the old `/ 1000`) lands on -1s
    // (…:59Z) instead, a full second late.
    let dt = bson::DateTime::from_millis(-1500);
    let expected =
        rust_xlsxwriter::ExcelDateTime::from_ymd(1969, 12, 31).unwrap().and_hms(23, 59, 58.0).unwrap();
    assert_eq!(excel_datetime(dt).unwrap().to_excel(), expected.to_excel());
}

#[test]
fn xlsx_cell_resolves_a_date_in_range_to_a_typed_date_variant() {
    let dt = bson::DateTime::from_millis(1709802930000);
    assert!(matches!(xlsx_cell(&bson::Bson::DateTime(dt)), XlsxCell::Date(_)));
}

#[test]
fn xlsx_cell_falls_back_to_text_with_iso_form_for_a_date_outside_excels_range() {
    // 1850-01-01 predates Excel's 1900 floor but is still a valid RFC 3339 year, so
    // the fallback is the plain ISO string, not an Extended JSON wrapper.
    let dt = bson::DateTime::from_millis(-3_786_825_600_000);
    match xlsx_cell(&bson::Bson::DateTime(dt)) {
        XlsxCell::Text(text) => assert_eq!(text, "1850-01-01T00:00:00Z"),
        other => panic!("expected Text, got a different XlsxCell variant: {:?}", std::mem::discriminant(&other)),
    }
}

#[test]
fn xlsx_cell_resolves_numbers_and_bools_to_their_own_variants() {
    assert!(matches!(xlsx_cell(&bson::Bson::Int32(7)), XlsxCell::Number(n) if n == 7.0));
    assert!(matches!(xlsx_cell(&bson::Bson::Int64(9_000_000_000)), XlsxCell::Number(n) if n == 9_000_000_000.0));
    assert!(matches!(xlsx_cell(&bson::Bson::Double(3.5)), XlsxCell::Number(n) if n == 3.5));
    assert!(matches!(xlsx_cell(&bson::Bson::Boolean(true)), XlsxCell::Bool(true)));
}

#[test]
fn xlsx_cell_resolves_null_to_blank() {
    assert!(matches!(xlsx_cell(&bson::Bson::Null), XlsxCell::Blank));
}

#[test]
fn xlsx_cell_falls_back_to_text_for_a_document_or_array() {
    let doc = bson::doc! { "street": "Rue de l'Église" };
    assert!(matches!(xlsx_cell(&bson::Bson::Document(doc)), XlsxCell::Text(_)));
    assert!(matches!(xlsx_cell(&bson::bson!(["a", "b"])), XlsxCell::Text(_)));
}

#[test]
fn json_value_style_defaults_to_plain() {
    assert_eq!(JsonValueStyle::default(), JsonValueStyle::Plain);
}

#[test]
fn plain_json_renders_object_id_as_a_bare_hex_string() {
    let oid = bson::oid::ObjectId::parse_str("5f8d0d55b54764421b7156c3").unwrap();
    let value = bson_to_plain_json(&bson::Bson::ObjectId(oid));
    assert_eq!(value, serde_json::json!("5f8d0d55b54764421b7156c3"));
}

#[test]
fn plain_json_renders_datetime_as_iso_8601_text_not_a_date_wrapper() {
    let dt = bson::DateTime::from_millis(1709802930000);
    let value = bson_to_plain_json(&bson::Bson::DateTime(dt));
    assert_eq!(value, serde_json::json!("2024-03-07T09:15:30Z"));
}

#[test]
fn plain_json_renders_decimal128_as_its_number_text() {
    let decimal: bson::Decimal128 = "19.99".parse().unwrap();
    let value = bson_to_plain_json(&bson::Bson::Decimal128(decimal));
    assert_eq!(value, serde_json::json!("19.99"));
}

#[test]
fn plain_json_keeps_scalars_as_their_native_json_type() {
    assert_eq!(bson_to_plain_json(&bson::Bson::Int32(-7)), serde_json::json!(-7));
    assert_eq!(bson_to_plain_json(&bson::Bson::Boolean(true)), serde_json::json!(true));
    assert_eq!(bson_to_plain_json(&bson::Bson::Null), serde_json::Value::Null);
}

#[test]
fn plain_json_recurses_through_a_document_and_unwraps_each_nested_scalar() {
    let oid = bson::oid::ObjectId::parse_str("5f8d0d55b54764421b7156c3").unwrap();
    let dt = bson::DateTime::from_millis(1709802930000);
    let doc = bson::doc! { "café": { "when": dt, "who": oid } };
    let value = bson_to_plain_json(&bson::Bson::Document(doc));
    assert_eq!(value["café"]["when"], serde_json::json!("2024-03-07T09:15:30Z"));
    assert_eq!(value["café"]["who"], serde_json::json!("5f8d0d55b54764421b7156c3"));
}

#[test]
fn plain_json_recurses_through_an_array_of_sub_documents() {
    // The nested case that matters most: an array of sub-documents each holding an
    // ObjectId and a date must come out fully unwrapped — not stringified the way the
    // flat cell renderer would leave it.
    let oid1 = bson::oid::ObjectId::parse_str("5f8d0d55b54764421b7156c3").unwrap();
    let oid2 = bson::oid::ObjectId::parse_str("5f8d0d55b54764421b7156c4").unwrap();
    let dt = bson::DateTime::from_millis(1709802930000);
    let doc = bson::doc! {
        "name": "São Paulo — depósito",
        "events": [
            { "id": oid1, "at": dt },
            { "id": oid2, "at": dt },
        ],
    };
    let value = bson_to_plain_json(&bson::Bson::Document(doc));
    let events = value["events"].as_array().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["id"], serde_json::json!("5f8d0d55b54764421b7156c3"));
    assert_eq!(events[0]["at"], serde_json::json!("2024-03-07T09:15:30Z"));
    assert_eq!(events[1]["id"], serde_json::json!("5f8d0d55b54764421b7156c4"));
}

#[test]
fn plain_json_keeps_an_out_of_range_date_as_a_date_object_not_a_string() {
    // Year 10000 can't be RFC 3339 text; Plain JSON must still give a `$date` object,
    // not that fallback text re-wrapped as a JSON string (escaped JSON-in-a-string).
    let dt = bson::DateTime::from_millis(253_402_300_800_000);
    let value = bson_to_plain_json(&bson::Bson::DateTime(dt));
    assert!(value.is_object(), "expected a $date object, got {value}");
    assert!(value.get("$date").is_some(), "expected a $date object, got {value}");
}

#[test]
fn plain_json_falls_back_to_extended_json_for_a_type_with_no_plain_form() {
    // Regex has no flat/plain decision — same bucket as `bson_to_plain_cell`'s fallback.
    let regex = bson::Regex { pattern: "^jo".to_string(), options: "i".to_string() };
    let value = bson_to_plain_json(&bson::Bson::RegularExpression(regex));
    assert!(value.get("$regularExpression").is_some(), "expected an Extended JSON fallback, got {value}");
}
