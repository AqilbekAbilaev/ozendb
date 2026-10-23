use super::cell;
use serde_json::{json, Value};

fn read(protocol: &str, bytes: &[u8]) -> Value {
    cell(protocol, None, Some(bytes))
}

#[test]
fn reads_null_as_null() {
    assert_eq!(cell("INT", None, None), Value::Null);
}

#[test]
fn reads_signed_integers_of_every_width() {
    assert_eq!(read("TINYINT", &[0xFF]), json!(-1));
    assert_eq!(read("SMALLINT", &(-300i16).to_le_bytes()), json!(-300));
    assert_eq!(read("MEDIUMINT", &(-8_388_608i32).to_le_bytes()), json!(-8_388_608));
    assert_eq!(read("INT", &i32::MIN.to_le_bytes()), json!(i32::MIN));
    assert_eq!(read("BIGINT", &(-42i64).to_le_bytes()), json!(-42));
}

#[test]
fn reads_unsigned_integers_without_a_sign() {
    assert_eq!(read("TINYINT UNSIGNED", &[0xFF]), json!(255));
    assert_eq!(read("INT UNSIGNED", &u32::MAX.to_le_bytes()), json!(u32::MAX));
}

#[test]
fn sends_integers_past_what_javascript_holds_exactly_as_text() {
    assert_eq!(read("BIGINT UNSIGNED", &u64::MAX.to_le_bytes()), json!("18446744073709551615"));
    assert_eq!(read("BIGINT", &i64::MIN.to_le_bytes()), json!("-9223372036854775808"));
    assert_eq!(read("BIGINT", &((1i64 << 53) - 1).to_le_bytes()), json!(9_007_199_254_740_991i64));
    assert_eq!(read("BIGINT", &(1i64 << 53).to_le_bytes()), json!("9007199254740992"));
}

#[test]
fn reads_tinyint_1_as_the_number_it_holds_with_the_sign_its_column_declares() {
    assert_eq!(read("BOOLEAN", &[1]), json!(1));
    assert_eq!(read("BOOLEAN", &[0xFB]), json!(-5));
    assert_eq!(cell("BOOLEAN", Some("tinyint(1) unsigned"), Some(&[0xFB])), json!(251));
}

#[test]
fn reads_a_year_as_a_number() {
    assert_eq!(read("YEAR", &2024u16.to_le_bytes()), json!(2024));
}

#[test]
fn reads_floats_as_their_shortest_decimal() {
    assert_eq!(read("FLOAT", &0.1f32.to_le_bytes()), json!(0.1));
    assert_eq!(read("DOUBLE", &(-1.5e300f64).to_le_bytes()), json!(-1.5e300));
}

#[test]
fn keeps_a_decimal_exact_as_text() {
    assert_eq!(read("DECIMAL", b"12345678901234567890.0123456789"), json!("12345678901234567890.0123456789"));
}

#[test]
fn reads_text_enum_and_set_as_strings() {
    assert_eq!(read("VARCHAR", "Straße ü".as_bytes()), json!("Straße ü"));
    assert_eq!(read("ENUM", b"paid"), json!("paid"));
    assert_eq!(read("CHAR", b"a,b"), json!("a,b"));
    assert_eq!(read("LONGTEXT", b""), json!(""));
}

#[test]
fn reads_dates_and_date_times_at_every_length() {
    assert_eq!(read("DATE", &[4, 0xE8, 0x07, 2, 29]), json!("2024-02-29"));
    assert_eq!(read("DATE", &[0]), json!("0000-00-00"));
    assert_eq!(read("DATETIME", &[4, 0xE8, 0x07, 1, 1]), json!("2024-01-01 00:00:00"));
    assert_eq!(read("TIMESTAMP", &[7, 0xE8, 0x07, 2, 29, 13, 14, 15]), json!("2024-02-29 13:14:15"));
    assert_eq!(read("DATETIME", &[11, 0xE8, 0x07, 2, 29, 13, 14, 15, 0x40, 0xE2, 0x01, 0]), json!("2024-02-29 13:14:15.123456"));
}

#[test]
fn reads_a_time_as_a_span_that_may_be_negative_or_past_a_day() {
    assert_eq!(read("TIME", &[8, 1, 34, 0, 0, 0, 22, 59, 59]), json!("-838:59:59"));
    assert_eq!(read("TIME", &[8, 0, 1, 0, 0, 0, 1, 2, 3]), json!("25:02:03"));
    assert_eq!(read("TIME", &[12, 0, 0, 0, 0, 0, 9, 5, 0, 1, 0, 0, 0]), json!("09:05:00.000001"));
    assert_eq!(read("TIME", &[0]), json!("00:00:00"));
}

#[test]
fn reads_json_as_the_value_it_holds() {
    assert_eq!(read("JSON", br#"{"a": [1, "b"]}"#), json!({ "a": [1, "b"] }));
}

#[test]
fn shows_binary_bit_and_geometry_as_hex() {
    assert_eq!(read("VARBINARY", &[0x00, 0xFF]), json!("0x00FF"));
    assert_eq!(read("BLOB", &[]), json!("0x"));
    assert_eq!(read("BIT", &[0x05]), json!("0x05"));
    assert_eq!(read("GEOMETRY", &[0, 0, 0, 0, 1]), json!("0x0000000001"));
}

#[test]
fn reads_text_with_a_binary_collation_as_text_when_its_column_says_so() {
    assert_eq!(cell("VARBINARY", Some("varchar(10)"), Some(b"Ab")), json!("Ab"));
    assert_eq!(cell("BLOB", Some("text"), Some(b"txt")), json!("txt"));
    assert_eq!(cell("VARBINARY", Some("varbinary(10)"), Some(b"Ab")), json!("0x4162"));
    assert_eq!(cell("BLOB", Some("longblob"), Some(b"Ab")), json!("0x4162"));
}

#[test]
fn shows_a_value_it_cannot_read_as_hex_rather_than_failing() {
    assert_eq!(read("INT", &[1, 2, 3]), json!("0x010203"));
    assert_eq!(read("DATE", &[4, 1]), json!("0x0401"));
    assert_eq!(read("TIME", &[8, 0, 0xFF, 0xFF, 0xFF, 0xFF, 0, 0, 0]), json!("0x0800FFFFFFFF000000"));
    assert_eq!(read("VARCHAR", &[0xFF]), json!("0xFF"));
    assert_eq!(read("SOMETHING NEW", &[7]), json!("0x07"));
}
