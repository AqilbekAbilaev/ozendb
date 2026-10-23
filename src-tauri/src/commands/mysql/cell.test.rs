//! The bytes MySQL's binary protocol sends for a date, read by hand. Every other type is
//! decoded by sqlx, whose values can't be built outside it, so those cases are in the
//! live tests (live_tests/mysql_browse.rs).
use super::{date_time, hex, is_text_type};
use serde_json::json;

#[test]
fn reads_dates_and_date_times_at_every_length() {
    assert_eq!(date_time(&[4, 0xE8, 0x07, 2, 29], false), Some(json!("2024-02-29")));
    assert_eq!(date_time(&[0], false), Some(json!("0000-00-00")));
    assert_eq!(date_time(&[4, 0xE8, 0x07, 1, 1], true), Some(json!("2024-01-01 00:00:00")));
    assert_eq!(date_time(&[7, 0xE8, 0x07, 2, 29, 13, 14, 15], true), Some(json!("2024-02-29 13:14:15")));
    assert_eq!(
        date_time(&[11, 0xE8, 0x07, 2, 29, 13, 14, 15, 0x40, 0xE2, 0x01, 0], true),
        Some(json!("2024-02-29 13:14:15.123456")),
    );
}

#[test]
fn refuses_a_date_whose_length_does_not_match_its_bytes() {
    assert_eq!(date_time(&[4, 1], false), None);
    assert_eq!(date_time(&[5, 0, 0, 0, 0, 0], true), None);
    assert_eq!(date_time(&[], true), None);
}

#[test]
fn shows_bytes_as_upper_case_hex() {
    assert_eq!(hex(&[0x00, 0xFF]), json!("0x00FF"));
    assert_eq!(hex(&[]), json!("0x"));
}

#[test]
fn tells_a_text_column_type_from_a_binary_one() {
    assert!(is_text_type("varchar(10)"));
    assert!(is_text_type("text"));
    assert!(is_text_type("enum('a','b')"));
    assert!(!is_text_type("varbinary(10)"));
    assert!(!is_text_type("longblob"));
    assert!(!is_text_type("textual"));
}
