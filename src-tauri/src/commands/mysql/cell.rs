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

const INTEGERS: [&str; 6] = ["BOOLEAN", "TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT"];

/// One cell as every prepared `sqlx::query` reads it. `declared` is the table column's
/// own `COLUMN_TYPE`, when the cell comes from a table: sqlx names a text column with a
/// binary collation (`utf8mb4_bin`) VARBINARY or BLOB, and calls TINYINT(1) BOOLEAN
/// whatever its sign. A value that can't be read shows as hex rather than failing the page.
pub(crate) fn cell(value: MySqlValueRef<'_>, declared: Option<&str>) -> Value {
    if value.is_null() {
        return Value::Null;
    }
    let protocol = value.type_info().into_owned();
    read(protocol.name(), declared, value.clone()).or_else(|| decode(value).map(hex)).unwrap_or(Value::Null)
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
        _ if INTEGERS.contains(&name) => integer(value, unsigned),
        "YEAR" => integer(value, true),
        "FLOAT" => float(decode::<f32>(value)?.to_string().parse().ok()?),
        "DOUBLE" => float(decode(value)?),
        // DECIMAL arrives as the server's own text, exact to the last digit.
        "DECIMAL" | "CHAR" | "VARCHAR" | "TINYTEXT" | "TEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" | "SET" => decode(value).map(Value::String),
        "DATE" => date_time(decode(value)?, false),
        "DATETIME" | "TIMESTAMP" => date_time(decode(value)?, true),
        "TIME" => decode(value).map(time),
        "JSON" => decode::<Json<Value>>(value).map(|json| json.0),
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" if declared.is_some_and(is_text_type) => {
            decode(value).map(Value::String)
        }
        // TODO #389: BIT, GEOMETRY and binary strings as more than hex.
        _ => None,
    }
}

fn is_text_type(declared: &str) -> bool {
    ["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "enum", "set"]
        .iter()
        .any(|text| declared.strip_prefix(text).is_some_and(|rest| rest.is_empty() || rest.starts_with([' ', '('])))
}

fn integer(value: MySqlValueRef<'_>, unsigned: bool) -> Option<Value> {
    let number = if unsigned { i128::from(decode::<u64>(value)?) } else { i128::from(decode::<i64>(value)?) };
    Some(if number.abs() <= SAFE_INTEGER { Value::from(number as i64) } else { Value::String(number.to_string()) })
}

fn float(value: f64) -> Option<Value> {
    serde_json::Number::from_f64(value).map(Value::Number)
}

/// A TIME is a span of up to 838 hours either way, not a time of day. Written here rather
/// than by `MySqlTime`'s own Display, which neither pads the hours nor keeps six digits.
fn time(span: MySqlTime) -> Value {
    // The sign's own Display: sqlx 0.9.0's `MySqlTime::is_negative` answers the opposite.
    let (sign, hours, minutes, seconds) = (span.sign(), span.hours(), span.minutes(), span.seconds());
    Value::String(format!("{sign}{hours:02}:{minutes:02}:{seconds:02}{}", fraction(span.microseconds())))
}

/// A length byte, then as much of year (2 bytes), month, day, hour, minute, second and
/// microseconds (4 bytes) as isn't zero. A length of 0 is the zero date.
// Read by hand: sqlx decodes dates only through its chrono or time feature, neither of
// which is enabled, and chrono refuses the zero month or day MySQL allows.
fn date_time(bytes: &[u8], with_time: bool) -> Option<Value> {
    let (&length, rest) = bytes.split_first()?;
    if !matches!(length, 0 | 4 | 7 | 11) || rest.len() != usize::from(length) {
        return None;
    }
    let at = |i: usize| rest.get(i).copied().unwrap_or(0);
    let year = u16::from_le_bytes([at(0), at(1)]);
    let mut text = format!("{year:04}-{:02}-{:02}", at(2), at(3));
    if with_time {
        let micros = rest.get(7..11).and_then(|b| b.try_into().ok()).map_or(0, u32::from_le_bytes);
        text.push_str(&format!(" {:02}:{:02}:{:02}{}", at(4), at(5), at(6), fraction(micros)));
    }
    Some(Value::String(text))
}

/// `.ffffff`, or nothing when there are no microseconds.
// TODO #389: as many digits as the column declares, not always six.
fn fraction(micros: u32) -> String {
    if micros > 0 {
        format!(".{micros:06}")
    } else {
        String::new()
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
