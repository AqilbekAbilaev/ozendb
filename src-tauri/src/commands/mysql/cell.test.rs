//! The bytes MySQL's binary protocol sends for a date or a BIT, read by hand, and the
//! rules each type's text follows. Every other type is decoded by sqlx, whose values
//! can't be built outside it, so those cases are in the live tests (live_tests/mysql_browse.rs).
use super::{bits, boolean, date, date_time, digits, fraction, hex, timestamp};
use chrono::FixedOffset;
use serde_json::json;

#[test]
fn reads_dates_and_date_times_at_every_length() {
    assert_eq!(date(&[4, 0xE8, 0x07, 2, 29]), Some(json!("2024-02-29")));
    assert_eq!(date(&[0]), Some(json!("0000-00-00")));
    assert_eq!(date_time(&[4, 0xE8, 0x07, 1, 1], Some(0)), Some(json!("2024-01-01 00:00:00")));
    assert_eq!(date_time(&[7, 0xE8, 0x07, 2, 29, 13, 14, 15], Some(0)), Some(json!("2024-02-29 13:14:15")));
    assert_eq!(
        date_time(&[11, 0xE8, 0x07, 2, 29, 13, 14, 15, 0x40, 0xE2, 0x01, 0], Some(6)),
        Some(json!("2024-02-29 13:14:15.123456")),
    );
}

#[test]
fn shows_a_timestamp_in_the_users_zone_with_its_offset_but_not_the_zero_date() {
    let tashkent = FixedOffset::east_opt(5 * 3600).unwrap();
    let new_york = FixedOffset::west_opt(4 * 3600).unwrap();
    let stamp = [11, 0xE8, 0x07, 6, 30, 22, 59, 59, 0xC0, 0xD4, 0x01, 0];
    assert_eq!(timestamp(&stamp, Some(3), &tashkent), Some(json!("2024-07-01 03:59:59.120+05:00")));
    assert_eq!(timestamp(&stamp, Some(3), &new_york), Some(json!("2024-06-30 18:59:59.120-04:00")));
    assert_eq!(timestamp(&[0], Some(3), &tashkent), Some(json!("0000-00-00 00:00:00.000")));
    assert_eq!(timestamp(&[4, 0, 0, 0, 0], Some(0), &tashkent), Some(json!("0000-00-00 00:00:00")));
}

#[test]
fn refuses_a_date_whose_length_does_not_match_its_bytes() {
    assert_eq!(date(&[4, 1]), None);
    assert_eq!(date_time(&[5, 0, 0, 0, 0, 0], Some(0)), None);
    assert_eq!(date_time(&[], Some(0)), None);
}

#[test]
fn writes_as_many_fraction_digits_as_the_column_declares() {
    assert_eq!(fraction(120_000, Some(3)), ".120");
    assert_eq!(fraction(0, Some(6)), ".000000");
    assert_eq!(fraction(500_000, Some(1)), ".5");
    assert_eq!(fraction(123_456, Some(0)), "");
}

#[test]
fn writes_six_fraction_digits_only_when_a_value_with_no_declared_type_has_some() {
    assert_eq!(fraction(1, None), ".000001");
    assert_eq!(fraction(0, None), "");
}

#[test]
fn reads_the_fraction_digits_from_the_declared_type() {
    assert_eq!(digits(Some("datetime(3)")), Some(3));
    assert_eq!(digits(Some("timestamp")), Some(0));
    assert_eq!(digits(Some("time(6)")), Some(6));
    assert_eq!(digits(None), None);
}

#[test]
fn reads_a_bit_value_as_its_big_endian_number() {
    assert_eq!(bits(&[0x05]), json!(5));
    assert_eq!(bits(&[0x01, 0x00]), json!(256));
    assert_eq!(bits(&[0xFF; 8]), json!("18446744073709551615"));
    assert_eq!(bits(&[]), json!(0));
}

#[test]
fn shows_a_tinyint_1_as_a_boolean_only_when_it_holds_0_or_1() {
    assert_eq!(boolean(json!(0)), json!(false));
    assert_eq!(boolean(json!(1)), json!(true));
    assert_eq!(boolean(json!(5)), json!(5));
    assert_eq!(boolean(json!(-1)), json!(-1));
}

#[test]
fn shows_bytes_as_upper_case_hex() {
    assert_eq!(hex(&[0x00, 0xFF]), json!("0x00FF"));
    assert_eq!(hex(&[]), json!("0x"));
}
