//! A MySQL result cell as the JSON the grid shows, read by the column's type. MySQL can't
//! wrap a row as JSON server-side the way PostgreSQL does: it writes binary and BIT
//! columns as "base64:type15:…" and corrupts a TIME past a day, so each cell is read here.
use serde_json::Value;
use sqlx::mysql::types::MySqlTime;
use sqlx::mysql::{MySql, MySqlValueRef};
use sqlx::types::Json;
use sqlx::{Decode, TypeInfo, ValueRef};

/// Integers past this lose digits as a JavaScript number, so they travel as text.
const SAFE_INTEGER: i128 = (1 << 53) - 1;

const INTEGERS: [&str; 5] = ["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT"];

/// What a TIMESTAMP's text ends with. Every session reads them in UTC (mysql/session.rs).
pub(super) const UTC: &str = "+00:00";

/// One cell as every prepared `sqlx::query` reads it. `declared` is the table column's
/// own `COLUMN_TYPE`, when the cell comes from a table: sqlx names a text column with a
/// binary collation (`utf8mb4_bin`) VARBINARY or BLOB, calls TINYINT(1) BOOLEAN whatever
/// its sign, and doesn't say how many fraction digits a time keeps. Binary strings,
/// GEOMETRY and any value that can't be read show as MySQL's own hex literal: exact to
/// the byte, where text would hide which bytes they are. A geometry's text (WKT) would
/// need `ST_AsText` in the SELECT.
pub(crate) fn cell(value: MySqlValueRef<'_>, declared: Option<&str>) -> Value {
    // Not `is_null`, which also answers true for a zero date (0000-00-00).
    let Some(bytes) = decode::<&[u8]>(value.clone()) else { return Value::Null };
    let protocol = value.type_info().into_owned();
    read(protocol.name(), declared, value).unwrap_or_else(|| hex(bytes))
}

fn decode<'r, T: Decode<'r, MySql>>(value: MySqlValueRef<'r>) -> Option<T> {
    T::decode(value).ok()
}

fn read(protocol: &str, declared: Option<&str>, value: MySqlValueRef<'_>) -> Option<Value> {
    let (name, unsigned) = match protocol.strip_suffix(" UNSIGNED") {
        Some(name) => (name, true),
        None => (protocol, declared.is_some_and(|t| t.contains("unsigned"))),
    };
    match name {
        "BOOLEAN" => integer(value, unsigned).map(boolean),
        _ if INTEGERS.contains(&name) => integer(value, unsigned),
        "YEAR" => integer(value, true),
        "BIT" => decode(value).map(bits),
        "FLOAT" => float(decode::<f32>(value)?.to_string().parse().ok()?),
        "DOUBLE" => float(decode(value)?),
        // DECIMAL arrives as the server's own text, exact to the last digit.
        "DECIMAL" | "CHAR" | "VARCHAR" | "TINYTEXT" | "TEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" | "SET" => decode(value).map(Value::String),
        "DATE" => date(decode(value)?),
        "DATETIME" => date_time(decode(value)?, digits(declared), ""),
        "TIMESTAMP" => date_time(decode(value)?, digits(declared), UTC),
        "TIME" => decode(value).map(|span| time(span, digits(declared))),
        "JSON" => decode::<Json<Value>>(value).map(|json| json.0),
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" if declared.is_some_and(is_text_type) => {
            decode(value).map(Value::String)
        }
        _ => None,
    }
}

fn is_text_type(declared: &str) -> bool {
    ["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "enum", "set"]
        .iter()
        .any(|text| declared.strip_prefix(text).is_some_and(|rest| rest.is_empty() || rest.starts_with([' ', '('])))
}

fn integer(value: MySqlValueRef<'_>, unsigned: bool) -> Option<Value> {
    Some(whole(if unsigned { i128::from(decode::<u64>(value)?) } else { i128::from(decode::<i64>(value)?) }))
}

fn whole(number: i128) -> Value {
    if number.abs() <= SAFE_INTEGER {
        Value::from(number as i64)
    } else {
        Value::String(number.to_string())
    }
}

/// TINYINT(1), which MySQL's BOOLEAN is, as true or false when it holds 1 or 0. It can
/// hold any small integer, and one that isn't a boolean shows as the number it is.
fn boolean(number: Value) -> Value {
    match number.as_i64() {
        Some(0) => Value::Bool(false),
        Some(1) => Value::Bool(true),
        _ => number,
    }
}

/// A BIT(n) as the number its bits make, as MySQL reads it in arithmetic and as a
/// filter compares it. It arrives as up to eight bytes, most significant first.
fn bits(bytes: &[u8]) -> Value {
    whole(bytes.iter().fold(0, |number, &byte| number << 8 | i128::from(byte)))
}

fn float(value: f64) -> Option<Value> {
    serde_json::Number::from_f64(value).map(Value::Number)
}

/// A TIME is a span of up to 838 hours either way, not a time of day. Written here rather
/// than by `MySqlTime`'s own Display, which neither pads the hours nor keeps the digits.
fn time(span: MySqlTime, digits: Option<usize>) -> Value {
    // The sign's own Display: sqlx 0.9.0's `MySqlTime::is_negative` answers the opposite.
    let (sign, hours, minutes, seconds) = (span.sign(), span.hours(), span.minutes(), span.seconds());
    Value::String(format!("{sign}{hours:02}:{minutes:02}:{seconds:02}{}", fraction(span.microseconds(), digits)))
}

/// A binary date's fields: a length byte, then as much of year (2 bytes), month, day,
/// hour, minute, second and microseconds (4 bytes) as isn't zero. A length of 0 is the
/// zero date.
// Read by hand: sqlx decodes dates only through its chrono or time feature, neither of
// which is enabled, and chrono refuses the zero month or day MySQL allows.
fn fields(bytes: &[u8]) -> Option<[u32; 7]> {
    let (&length, rest) = bytes.split_first()?;
    if !matches!(length, 0 | 4 | 7 | 11) || rest.len() != usize::from(length) {
        return None;
    }
    let at = |i: usize| u32::from(rest.get(i).copied().unwrap_or(0));
    let micros = rest.get(7..11).and_then(|b| b.try_into().ok()).map_or(0, u32::from_le_bytes);
    Some([at(0) | at(1) << 8, at(2), at(3), at(4), at(5), at(6), micros])
}

fn date(bytes: &[u8]) -> Option<Value> {
    let [year, month, day, ..] = fields(bytes)?;
    Some(Value::String(format!("{year:04}-{month:02}-{day:02}")))
}

/// A DATETIME, or a TIMESTAMP with `zone` set. The zero date is no instant, so it has none.
fn date_time(bytes: &[u8], digits: Option<usize>, zone: &str) -> Option<Value> {
    let [year, month, day, hour, minute, second, micros] = fields(bytes)?;
    let zone = if year == 0 { "" } else { zone };
    Some(Value::String(format!(
        "{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}{}{zone}",
        fraction(micros, digits)
    )))
}

/// The fraction digits a time column declares: 3 for `datetime(3)`, 0 for `datetime`.
fn digits(declared: Option<&str>) -> Option<usize> {
    Some(declared?.split_once('(').and_then(|(_, rest)| rest.strip_suffix(')')?.parse().ok()).unwrap_or(0))
}

/// The seconds' fraction to the declared `digits`, as MySQL writes it; with none
/// declared, six digits when there is a fraction.
fn fraction(micros: u32, digits: Option<usize>) -> String {
    match digits.unwrap_or(if micros > 0 { 6 } else { 0 }).min(6) {
        0 => String::new(),
        digits => format!(".{micros:06}")[..=digits].to_string(),
    }
}

fn hex(bytes: &[u8]) -> Value {
    Value::String(bytes.iter().fold(String::from("0x"), |mut text, byte| {
        text.push_str(&format!("{byte:02X}"));
        text
    }))
}

#[cfg(test)]
#[path = "cell.test.rs"]
mod tests;
