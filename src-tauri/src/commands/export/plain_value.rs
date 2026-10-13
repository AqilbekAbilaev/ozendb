use crate::error::AppError;
use mongodb::bson;
use serde::Deserialize;

// How a JSON export renders ObjectId/DateTime/Decimal128: `Extended` keeps them wrapped
// (`{"$oid": …}`, …) — what `mongoexport` writes, and what lets a file round-trip back
// in with its types intact — while `Plain` unwraps them to the text a user would have
// typed. `Plain` is the default (#289): most exports go to a spreadsheet, a script or
// another system that just wants the values, not back into MongoDB, so the common case
// should be the easy one. A request that omits the field entirely gets Plain too.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum JsonValueStyle {
    Extended,
    #[default]
    Plain,
}

// Render a single BSON value as a flat plain-text cell (CSV, and XLSX's fallback for
// anything that isn't a native Excel type). ObjectId/Decimal128/DateTime become the text
// a user would have typed, not Extended JSON's wrapper; Null is blank; anything with no
// flat form (Document, Array, …) falls back to Extended JSON.
pub(crate) fn bson_to_plain_cell(value: &bson::Bson) -> String {
    match value {
        bson::Bson::String(val) => val.clone(),
        bson::Bson::Boolean(val) => val.to_string(),
        bson::Bson::Int32(val) => val.to_string(),
        bson::Bson::Int64(val) => val.to_string(),
        bson::Bson::Double(val) => val.to_string(),
        bson::Bson::Null => String::new(),
        bson::Bson::ObjectId(val) => val.to_hex(),
        bson::Bson::Decimal128(val) => val.to_string(),
        bson::Bson::DateTime(val) => plain_datetime_text(*val)
            .unwrap_or_else(|| serde_json::Value::from(bson::Bson::DateTime(*val)).to_string()),
        other => serde_json::Value::from(other.clone()).to_string(),
    }
}

// Recursive sibling of `bson_to_plain_cell`: Document/Array stay real structure
// (recursed into, not stringified), and an out-of-range date keeps its `$date` object
// rather than the flat renderer's text fallback — a JSON file must not hold a string of
// escaped JSON.
pub(crate) fn bson_to_plain_json(value: &bson::Bson) -> serde_json::Value {
    match value {
        bson::Bson::ObjectId(val) => serde_json::Value::String(val.to_hex()),
        // Stays a string, not a number: JSON numbers are IEEE-754 doubles, which would
        // lose exactly the precision Decimal128 exists to preserve.
        bson::Bson::Decimal128(val) => serde_json::Value::String(val.to_string()),
        bson::Bson::DateTime(val) => match plain_datetime_text(*val) {
            Some(text) => serde_json::Value::String(text),
            None => serde_json::Value::from(bson::Bson::DateTime(*val)),
        },
        bson::Bson::Document(doc) => serde_json::Value::Object(
            doc.iter().map(|(key, val)| (key.clone(), bson_to_plain_json(val))).collect(),
        ),
        bson::Bson::Array(items) => {
            serde_json::Value::Array(items.iter().map(bson_to_plain_json).collect())
        }
        other => serde_json::Value::from(other.clone()),
    }
}

// DateTime -> ISO-8601 text, or `None` for a date outside the four-digit-year range
// RFC 3339 can express — each caller picks its own fallback for that one value.
fn plain_datetime_text(value: bson::DateTime) -> Option<String> {
    value.try_to_rfc3339_string().ok()
}

// bson::DateTime stores milliseconds; rust_xlsxwriter's ExcelDateTime::from_timestamp
// takes Unix seconds. `div_euclid` floors toward negative infinity (unlike `/`, which
// truncates toward zero and so rounds a pre-1970 timestamp's seconds up). Returns the
// library's own `DateTimeRangeError` when the date falls outside Excel's representable
// 1900-9999 range; the caller falls back to `bson_to_plain_cell`'s ISO text for that cell.
pub(crate) fn excel_datetime(
    value: bson::DateTime,
) -> Result<rust_xlsxwriter::ExcelDateTime, rust_xlsxwriter::XlsxError> {
    rust_xlsxwriter::ExcelDateTime::from_timestamp(value.timestamp_millis().div_euclid(1000))
}

// A file-writing failure from rust_xlsxwriter isn't user input, so report it as I/O.
pub(crate) fn xlsx_error(e: rust_xlsxwriter::XlsxError) -> AppError {
    AppError::Io(std::io::Error::other(e.to_string()))
}

// Built once per workbook (like the caller's own `header_format`) rather than per cell.
// An ISO-like display so a date cell reads the same way the CSV/JSON exports render
// the same value.
pub(crate) fn xlsx_date_format() -> rust_xlsxwriter::Format {
    rust_xlsxwriter::Format::new().set_num_format("yyyy-mm-dd hh:mm:ss")
}

// The native Excel cell shape a BSON value decides on, independent of actually writing
// it — a date in Excel's 1900-9999 range gets a typed cell, one outside it falls back to
// the same ISO text the CSV/JSON exports use, so a bad export never aborts.
pub(crate) enum XlsxCell {
    Number(f64),
    Bool(bool),
    Date(rust_xlsxwriter::ExcelDateTime),
    Text(String),
    Blank,
}

pub(crate) fn xlsx_cell(value: &bson::Bson) -> XlsxCell {
    match value {
        bson::Bson::Null => XlsxCell::Blank,
        bson::Bson::Boolean(val) => XlsxCell::Bool(*val),
        bson::Bson::Int32(val) => XlsxCell::Number(*val as f64),
        bson::Bson::Int64(val) => XlsxCell::Number(*val as f64),
        bson::Bson::Double(val) => XlsxCell::Number(*val),
        bson::Bson::DateTime(val) => match excel_datetime(*val) {
            Ok(excel_date) => XlsxCell::Date(excel_date),
            Err(_) => XlsxCell::Text(bson_to_plain_cell(value)),
        },
        other => XlsxCell::Text(bson_to_plain_cell(other)),
    }
}

// Write one BSON value into a worksheet cell: a thin match over `xlsx_cell`'s decision,
// with no logic of its own.
pub(crate) fn xlsx_write_cell(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    col: u16,
    value: &bson::Bson,
    date_format: &rust_xlsxwriter::Format,
) -> Result<(), AppError> {
    let result = match xlsx_cell(value) {
        XlsxCell::Blank => return Ok(()),
        XlsxCell::Bool(val) => worksheet.write_boolean(row, col, val),
        XlsxCell::Number(val) => worksheet.write_number(row, col, val),
        XlsxCell::Date(val) => worksheet.write_datetime_with_format(row, col, &val, date_format),
        XlsxCell::Text(val) => worksheet.write_string(row, col, val),
    };
    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(xlsx_error(e)),
    }
}

#[cfg(test)]
#[path = "plain_value.test.rs"]
mod tests;
