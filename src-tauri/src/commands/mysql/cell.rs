//! A MySQL result cell as the JSON the grid shows, read by the column's type. MySQL can't
//! wrap a row as JSON server-side the way PostgreSQL does: it writes binary and BIT
//! columns as "base64:type15:…" and corrupts a TIME past a day, so each cell is read here.
use serde_json::Value;

/// Integers past this lose digits as a JavaScript number, so they travel as text.
const SAFE_INTEGER: i128 = (1 << 53) - 1;

const INTEGERS: [&str; 6] = ["BOOLEAN", "TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT"];

/// One cell in MySQL's binary protocol, which is what every prepared `sqlx::query` reads.
/// `protocol` is sqlx's name for the column's type and `declared` the table column's own
/// `COLUMN_TYPE`, when the cell comes from a table: sqlx names a text column with a binary
/// collation (`utf8mb4_bin`) VARBINARY or BLOB, and calls TINYINT(1) BOOLEAN whatever its
/// sign. A value that can't be read shows as hex rather than failing the page.
pub(crate) fn cell(protocol: &str, declared: Option<&str>, raw: Option<&[u8]>) -> Value {
    let Some(bytes) = raw else { return Value::Null };
    read(protocol, declared, bytes).unwrap_or_else(|| hex(bytes))
}

fn read(protocol: &str, declared: Option<&str>, bytes: &[u8]) -> Option<Value> {
    let (name, unsigned) = match protocol.strip_suffix(" UNSIGNED") {
        Some(name) => (name, true),
        None => (protocol, declared.is_some_and(|t| t.contains("unsigned"))),
    };
    match name {
        _ if INTEGERS.contains(&name) => integer(bytes, unsigned),
        "YEAR" => integer(bytes, true),
        "FLOAT" => float(f32::from_le_bytes(bytes.try_into().ok()?).to_string().parse().ok()?),
        "DOUBLE" => float(f64::from_le_bytes(bytes.try_into().ok()?)),
        // DECIMAL arrives as the server's own text, exact to the last digit.
        "DECIMAL" | "CHAR" | "VARCHAR" | "TINYTEXT" | "TEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" | "SET" => text(bytes),
        "DATE" => date_time(bytes, false),
        "DATETIME" | "TIMESTAMP" => date_time(bytes, true),
        "TIME" => time(bytes),
        "JSON" => serde_json::from_slice(bytes).ok(),
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" if declared.is_some_and(is_text_type) => text(bytes),
        // TODO #389: BIT, GEOMETRY and binary strings as more than hex.
        _ => None,
    }
}

fn is_text_type(declared: &str) -> bool {
    ["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "enum", "set"]
        .iter()
        .any(|text| declared.strip_prefix(text).is_some_and(|rest| rest.is_empty() || rest.starts_with([' ', '('])))
}

/// A little-endian integer of 1, 2, 4 or 8 bytes.
fn integer(bytes: &[u8], unsigned: bool) -> Option<Value> {
    if !matches!(bytes.len(), 1 | 2 | 4 | 8) {
        return None;
    }
    let mut padded = [0u8; 8];
    padded[..bytes.len()].copy_from_slice(bytes);
    let value = if unsigned {
        i128::from(u64::from_le_bytes(padded))
    } else {
        let shift = 64 - 8 * bytes.len();
        i128::from(i64::from_le_bytes(padded) << shift >> shift)
    };
    Some(if value.abs() <= SAFE_INTEGER { Value::from(value as i64) } else { Value::String(value.to_string()) })
}

fn float(value: f64) -> Option<Value> {
    serde_json::Number::from_f64(value).map(Value::Number)
}

fn text(bytes: &[u8]) -> Option<Value> {
    std::str::from_utf8(bytes).ok().map(|s| Value::String(s.to_string()))
}

/// A length byte, then as much of year (2 bytes), month, day, hour, minute, second and
/// microseconds (4 bytes) as isn't zero. A length of 0 is the zero date.
fn date_time(bytes: &[u8], with_time: bool) -> Option<Value> {
    let (&length, rest) = bytes.split_first()?;
    if !matches!(length, 0 | 4 | 7 | 11) || rest.len() != usize::from(length) {
        return None;
    }
    let at = |i: usize| rest.get(i).copied().unwrap_or(0);
    let year = u16::from_le_bytes([at(0), at(1)]);
    let mut text = format!("{year:04}-{:02}-{:02}", at(2), at(3));
    if with_time {
        text.push_str(&format!(" {:02}:{:02}:{:02}{}", at(4), at(5), at(6), fraction(&rest[rest.len().min(7)..])));
    }
    Some(Value::String(text))
}

/// A length byte, then the sign, days (4 bytes), hours, minutes, seconds and microseconds
/// (4 bytes): a TIME is a span of up to 838 hours either way, not a time of day.
fn time(bytes: &[u8]) -> Option<Value> {
    let (&length, rest) = bytes.split_first()?;
    if length == 0 {
        return Some(Value::String(String::from("00:00:00")));
    }
    if !matches!(length, 8 | 12) || rest.len() != usize::from(length) {
        return None;
    }
    let sign = if rest[0] == 1 { "-" } else { "" };
    let hours = u32::from_le_bytes(rest[1..5].try_into().ok()?).checked_mul(24)?.checked_add(u32::from(rest[5]))?;
    Some(Value::String(format!("{sign}{hours:02}:{:02}:{:02}{}", rest[6], rest[7], fraction(&rest[8..]))))
}

/// `.ffffff` from four bytes of microseconds, or nothing when there are none.
// TODO #389: as many digits as the column declares, not always six.
fn fraction(bytes: &[u8]) -> String {
    match bytes.try_into().map(u32::from_le_bytes) {
        Ok(micros) if micros > 0 => format!(".{micros:06}"),
        _ => String::new(),
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
