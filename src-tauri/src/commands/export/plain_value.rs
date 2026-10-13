use crate::error::AppError;
use mongodb::bson;
use serde::Deserialize;

// How a JSON export renders ObjectId/DateTime/Decimal128: `Extended` keeps them wrapped
// (`{"$oid": …}`, …) — what `mongoexport` writes, and what lets a file round-trip back
// in with its types intact — while `Plain` unwraps them to the text a user would have
// typed. `Extended` is the default so an older frontend call (or a request that omits
// the field entirely) can't silently change output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum JsonValueStyle {
    #[default]
    Extended,
    Plain,
}

// Render a single BSON value as a flat plain-text cell — the form a CSV cell takes,
// and what an XLSX cell falls back to for anything that isn't a native Excel type (see
// `excel_datetime` for the one BSON type, DateTime, that gets a real typed cell instead).
// ObjectId becomes hex and Decimal128 its number text, matching what a user typing the
// same value would have written — not Extended JSON's `{"$oid": …}` / `{"$numberDecimal":
// …}` wrappers. Null is blank. Documents, arrays, Binary, Timestamp and the rest have no
// flat text form at all — a document or array nested in one cell is still nested data, so
// JSON is a defensible rendering, while a wrapper around a single scalar (ObjectId,
// Decimal128, DateTime) is not, which is why those three get their own arms here.
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
// takes Unix seconds, so this drops sub-second precision — acceptable for a spreadsheet
// cell, where no format shows milliseconds anyway. Returns the library's own
// `DateTimeRangeError` when the date falls outside Excel's representable 1900-9999
// range; the caller falls back to `bson_to_plain_cell`'s ISO text for that cell.
pub(crate) fn excel_datetime(
    value: bson::DateTime,
) -> Result<rust_xlsxwriter::ExcelDateTime, rust_xlsxwriter::XlsxError> {
    rust_xlsxwriter::ExcelDateTime::from_timestamp(value.timestamp_millis() / 1000)
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

// Write one BSON value into a worksheet cell, using a native Excel type where it maps
// cleanly (numbers, booleans, dates) and the plain text form for everything else.
// `Null` is left as a blank cell.
pub(crate) fn xlsx_write_cell(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    col: u16,
    value: &bson::Bson,
    date_format: &rust_xlsxwriter::Format,
) -> Result<(), AppError> {
    if let bson::Bson::DateTime(val) = value {
        return xlsx_write_datetime(worksheet, row, col, *val, date_format);
    }
    let result = match value {
        bson::Bson::Null => return Ok(()),
        bson::Bson::Boolean(val) => worksheet.write_boolean(row, col, *val),
        bson::Bson::Int32(val) => worksheet.write_number(row, col, *val as f64),
        bson::Bson::Int64(val) => worksheet.write_number(row, col, *val as f64),
        bson::Bson::Double(val) => worksheet.write_number(row, col, *val),
        other => worksheet.write_string(row, col, bson_to_plain_cell(other)),
    };
    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(xlsx_error(e)),
    }
}

// A date Excel cannot represent (outside its 1900-9999 year range) must not abort the
// whole export — write that one cell as the same ISO text the CSV/JSON exports use
// instead of propagating the error.
fn xlsx_write_datetime(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    col: u16,
    value: bson::DateTime,
    date_format: &rust_xlsxwriter::Format,
) -> Result<(), AppError> {
    let result = match excel_datetime(value) {
        Ok(excel_date) => worksheet.write_datetime_with_format(row, col, &excel_date, date_format),
        Err(_) => worksheet.write_string(row, col, bson_to_plain_cell(&bson::Bson::DateTime(value))),
    };
    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(xlsx_error(e)),
    }
}

#[cfg(test)]
#[path = "plain_value.test.rs"]
mod tests;
