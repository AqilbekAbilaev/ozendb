use crate::error::AppError;
use mongodb::bson;
use serde::Serialize;
use tauri::State;

use crate::resolve;

use super::{
    next_document, MAX_QUERY_TIME, AppContext
};

const DEFAULT_SCAN: i64 = 1000;
const MAX_SCAN: i64 = 5000;
const DEFAULT_MAX_HITS: usize = 200;
const MAX_HITS: usize = 1000;

// One matching field inside one document, the way Studio-3T's "Search in…" grid rows
// look: which collection and document, the dotted path to the field, and its value as
// text (with the search term highlighted client-side).
#[derive(Serialize)]
pub struct SearchHit {
    pub database: String,
    pub collection: String,
    pub id: String,
    pub path: String,
    pub value: String,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub scanned: u64,
    // True when the total-hit cap was reached and later matches were dropped.
    pub truncated: bool,
}

// How a single value/name is tested against the search term. Substring is the default
// path; RegEx compiles the term as a pattern. Case sensitivity is folded in here so the
// walk never has to think about it.
enum Matcher {
    // `needle` is pre-lowercased when case-insensitive; the haystack is lowercased to match.
    Substr { needle: String, case_sensitive: bool },
    Regex(regex::Regex),
}

impl Matcher {
    fn matches(&self, hay: &str) -> bool {
        match self {
            Matcher::Substr { needle, case_sensitive } => {
                if *case_sensitive {
                    hay.contains(needle.as_str())
                } else {
                    hay.to_lowercase().contains(needle.as_str())
                }
            }
            Matcher::Regex(re) => re.is_match(hay),
        }
    }
}

// What the search looks at: field values, field names, or both.
struct Scope {
    values: bool,
    names: bool,
}

// Text form of a scalar value for value-matching. Documents and arrays return None —
// they are recursed into rather than matched whole.
fn scalar_text(value: &bson::Bson) -> Option<String> {
    match value {
        bson::Bson::String(val) => Some(val.clone()),
        bson::Bson::Int32(val) => Some(val.to_string()),
        bson::Bson::Int64(val) => Some(val.to_string()),
        bson::Bson::Double(val) => Some(val.to_string()),
        bson::Bson::Boolean(val) => Some(val.to_string()),
        bson::Bson::ObjectId(val) => Some(val.to_hex()),
        bson::Bson::Decimal128(val) => Some(val.to_string()),
        bson::Bson::DateTime(val) => match val.try_to_rfc3339_string() {
            Ok(text) => Some(text),
            Err(_) => None,
        },
        _ => None,
    }
}

// Display text for any value, used for the grid's Value column on a name match (where
// the matched field may itself be a document or array). Scalars use their text form;
// containers render as compact JSON.
fn value_text(value: &bson::Bson) -> String {
    match scalar_text(value) {
        Some(text) => text,
        None => match value {
            bson::Bson::Document(doc) => {
                bson::Bson::Document(doc.clone()).into_relaxed_extjson().to_string()
            }
            bson::Bson::Array(items) => {
                bson::Bson::Array(items.clone()).into_relaxed_extjson().to_string()
            }
            other => other.to_string(),
        },
    }
}

// The document's _id as display text (ObjectId as hex; anything else as its value text).
fn id_text(doc: &bson::Document) -> String {
    match doc.get("_id") {
        Some(value) => value_text(value),
        None => String::new(),
    }
}

// Walk one value, appending (path, value-text) for every field whose value or name
// matches. `path` is the dotted path to `value` (empty at the document root).
fn collect(value: &bson::Bson, path: &str, matcher: &Matcher, scope: &Scope, out: &mut Vec<(String, String)>) {
    match value {
        bson::Bson::Document(doc) => {
            for (key, child) in doc.iter() {
                let child_path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{}.{}", path, key)
                };
                if scope.names && matcher.matches(key) {
                    out.push((child_path.clone(), value_text(child)));
                }
                collect(child, &child_path, matcher, scope, out);
            }
        }
        bson::Bson::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                let child_path = format!("{}.{}", path, index);
                collect(child, &child_path, matcher, scope, out);
            }
        }
        scalar => {
            if scope.values {
                if let Some(text) = scalar_text(scalar) {
                    if matcher.matches(&text) {
                        out.push((path.to_string(), text));
                    }
                }
            }
        }
    }
}

/// Search a database for fields whose value or name matches `term`, the way Studio-3T's
/// "Search in…" does — one grid row per matching field (its collection, document _id,
/// dotted path, and value). `collection`, when given, restricts the search to that one
/// collection; otherwise every collection in the database is scanned. `scope` is "value"
/// | "name" | (default) both; `match_case` toggles case sensitivity; `regex` treats the
/// term as a pattern. Each collection is scanned up to `scan_limit` documents; the flat
/// result is capped at `max_hits` rows total (truncation is reported).
#[tauri::command]
pub async fn search_collections(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    collection: Option<String>,
    term: String,
    scope: Option<String>,
    match_case: Option<bool>,
    regex: Option<bool>,
    scan_limit: Option<i64>,
    max_hits: Option<i64>,
) -> Result<SearchResult, AppError> {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return Ok(SearchResult { hits: Vec::new(), scanned: 0, truncated: false });
    }

    let case_sensitive = match_case.unwrap_or(false);
    let matcher = if regex.unwrap_or(false) {
        let mut builder = regex::RegexBuilder::new(trimmed);
        builder.case_insensitive(!case_sensitive);
        match builder.build() {
            Ok(re) => Matcher::Regex(re),
            Err(e) => return Err(AppError::Validation(format!("Invalid regular expression: {}", e))),
        }
    } else {
        let needle = if case_sensitive {
            trimmed.to_string()
        } else {
            trimmed.to_lowercase()
        };
        Matcher::Substr { needle: needle, case_sensitive: case_sensitive }
    };

    let scope = match scope.as_deref() {
        Some("value") => Scope { values: true, names: false },
        Some("name") => Scope { values: false, names: true },
        _ => Scope { values: true, names: true },
    };

    let client = resolve!(ctx.client(&id).await);
    let db = client.database(&database);

    let scan = match scan_limit {
        Some(val) if val > 0 => val.min(MAX_SCAN),
        _ => DEFAULT_SCAN,
    };
    let hit_cap = match max_hits {
        Some(val) if val > 0 => (val as usize).min(MAX_HITS),
        _ => DEFAULT_MAX_HITS,
    };

    let names = match collection {
        Some(name) if !name.trim().is_empty() => vec![name],
        _ => match db.list_collection_names().await {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        },
    };

    let mut hits: Vec<SearchHit> = Vec::new();
    let mut scanned: u64 = 0;
    let mut truncated = false;
    'collections: for name in names {
        let col = db.collection::<bson::Document>(&name);
        let mut cursor = match col.find(bson::doc! {}).limit(scan).max_time(MAX_QUERY_TIME).await {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        };
        loop {
            let doc: bson::Document = match next_document(&mut cursor).await {
                Ok(Some(value)) => value,
                Ok(None) => break,
                Err(e) => return Err(e),
            };
            scanned += 1;

            let mut found: Vec<(String, String)> = Vec::new();
            collect(&bson::Bson::Document(doc.clone()), "", &matcher, &scope, &mut found);
            if found.is_empty() {
                continue;
            }
            let id_str = id_text(&doc);
            for (path, value) in found {
                if hits.len() >= hit_cap {
                    truncated = true;
                    break 'collections;
                }
                hits.push(SearchHit {
                    database: database.clone(),
                    collection: name.clone(),
                    id: id_str.clone(),
                    path: path,
                    value: value,
                });
            }
        }
    }

    Ok(SearchResult { hits: hits, scanned: scanned, truncated: truncated })
}

#[cfg(test)]
#[path = "search.test.rs"]
mod tests;
