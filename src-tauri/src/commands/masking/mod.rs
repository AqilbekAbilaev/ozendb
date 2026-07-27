use crate::error::AppError;
use mongodb::bson;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::resolve;

use super::{
    parse_ejson_document, MAX_QUERY_TIME, AppContext
};

// A per-field masking instruction. `field` is a dotted path (e.g. "contact.email").
// Only fields the user chose to mask are sent; everything else is exported as-is.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MaskRule {
    pub field: String,
    // "redact" | "hash" | "partial" | "nullify" | "remove"
    pub strategy: String,
    #[serde(default)]
    pub keep_start: Option<usize>,
    #[serde(default)]
    pub keep_end: Option<usize>,
    #[serde(default)]
    pub mask_char: Option<String>,
    #[serde(default)]
    pub replacement: Option<String>,
}

// FNV-1a 64-bit: a tiny, dependency-free, deterministic hash. Not cryptographic,
// but for masking it only needs to hide the original value while keeping equal
// inputs equal (so joins/relationships in the masked copy still line up).
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

// Flatten a scalar (or, as a fallback, any value) to the text the string-based
// strategies operate on.
fn value_to_string(value: &bson::Bson) -> String {
    match value {
        bson::Bson::String(val) => val.clone(),
        bson::Bson::Boolean(val) => val.to_string(),
        bson::Bson::Int32(val) => val.to_string(),
        bson::Bson::Int64(val) => val.to_string(),
        bson::Bson::Double(val) => val.to_string(),
        bson::Bson::ObjectId(val) => val.to_hex(),
        bson::Bson::Null => String::new(),
        other => serde_json::Value::from(other.clone()).to_string(),
    }
}

// Keep the first `start` and last `end` characters, replacing the middle with the
// mask character. Strings too short to show any window are fully masked (length
// preserved), so nothing leaks.
fn partial_mask(text: &str, start: usize, end: usize, mask_char: char) -> String {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    if n <= start + end {
        return std::iter::repeat(mask_char).take(n).collect();
    }
    let mut out = String::new();
    for ch in &chars[..start] {
        out.push(*ch);
    }
    for _ in 0..(n - start - end) {
        out.push(mask_char);
    }
    for ch in &chars[n - end..] {
        out.push(*ch);
    }
    out
}

// Compute the replacement for one value. `Ok(None)` means "remove the field".
fn strategy_result(value: &bson::Bson, rule: &MaskRule) -> Result<Option<bson::Bson>, String> {
    match rule.strategy.as_str() {
        "remove" => Ok(None),
        "nullify" => Ok(Some(bson::Bson::Null)),
        "redact" => {
            let token = match &rule.replacement {
                Some(val) => val.clone(),
                None => "***".to_string(),
            };
            Ok(Some(bson::Bson::String(token)))
        }
        "hash" => {
            let text = value_to_string(value);
            let digest = fnv1a64(text.as_bytes());
            Ok(Some(bson::Bson::String(format!("{digest:016x}"))))
        }
        "partial" => {
            let text = value_to_string(value);
            let mask_char = match &rule.mask_char {
                Some(val) => val.chars().next().unwrap_or('*'),
                None => '*',
            };
            let start = rule.keep_start.unwrap_or(0);
            let end = rule.keep_end.unwrap_or(0);
            Ok(Some(bson::Bson::String(partial_mask(&text, start, end, mask_char))))
        }
        other => Err(format!("Unknown masking strategy: {other}")),
    }
}

// Apply one rule, descending dotted paths into sub-documents. A path that does not
// resolve (missing field, or an intermediate that is not a document) is silently
// skipped so a rule that doesn't apply to a given document is a no-op.
fn apply_at(doc: &mut bson::Document, segments: &[&str], rule: &MaskRule) -> Result<(), String> {
    if segments.len() == 1 {
        let key = segments[0];
        let current = match doc.get(key) {
            Some(val) => val.clone(),
            None => return Ok(()),
        };
        match strategy_result(&current, rule) {
            Ok(Some(new_value)) => {
                doc.insert(key.to_string(), new_value);
            }
            Ok(None) => {
                doc.remove(key);
            }
            Err(e) => return Err(e),
        }
        return Ok(());
    }
    let head = segments[0];
    match doc.get_mut(head) {
        Some(bson::Bson::Document(sub)) => apply_at(sub, &segments[1..], rule),
        _ => Ok(()),
    }
}

pub(crate) fn apply_rules(doc: &mut bson::Document, rules: &[MaskRule]) -> Result<(), String> {
    for rule in rules {
        let segments: Vec<&str> = rule.field.split('.').collect();
        match apply_at(doc, &segments, rule) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Export an obfuscated copy of a collection: read documents (optionally filtered
/// and capped), apply the per-field masking rules, and write the result to `path`
/// as pretty JSON or CSV. Returns the number of documents written. The masking
/// happens in-memory on the exported copy — the source collection is untouched.
#[tauri::command]
pub async fn export_masked_collection(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: String,
    filter: String,
    rules: Vec<MaskRule>,
    path: String,
    format: String,
    limit: Option<i64>,
) -> Result<usize, AppError> {
    let col = resolve!(ctx.collection(&id, &database, &collection).await);

    let filter_doc = match parse_ejson_document(&filter) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };

    // Stream to disk, applying the masking rules per document. The rules can drop
    // a key, so the shared exporter runs this transform in both CSV passes.
    super::stream_export(
        &col,
        filter_doc,
        limit,
        Some(MAX_QUERY_TIME),
        &path,
        &format,
        |doc: &mut bson::Document| -> Result<(), AppError> {
            match apply_rules(doc, &rules) {
                Ok(_) => Ok(()),
                Err(e) => Err(AppError::Bson(e)),
            }
        },
    )
    .await
}

#[cfg(test)]
#[path = "masking.test.rs"]
mod tests;
