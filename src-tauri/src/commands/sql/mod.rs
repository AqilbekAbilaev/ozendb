//! What every SQL engine's commands share and that never talks to a server: the shapes
//! a table tab sends and gets back, and reading SQL with `sqlparser` in the engine's own
//! dialect. Each engine's commands (`commands/postgres/`) do the talking.
use serde::{Deserialize, Serialize};

pub mod format;
pub mod read_select;
pub mod statement;

/// Cap on rows returned by an arbitrary or browse query — the SQL sibling of
/// `AGG_RESULT_CAP` for Mongo's `run_aggregate`. Requested as `<cap>+1` so
/// truncation is detectable without a second `COUNT(*)` round trip.
pub(crate) const ROW_RESULT_CAP: i64 = 10_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlQueryResult {
    /// Column names in the query's own order, from the statement's describe —
    /// never inferred from a decoded row's own shape (see PostgreSQL's `run_wrapped`
    /// for why: two columns can share a name, or have none at all).
    pub columns: Vec<String>,
    /// One array of values per row, aligned to `columns` by position — not one
    /// JSON object per row, which would silently collapse duplicate column names.
    pub rows: Vec<Vec<serde_json::Value>>,
    pub truncated: bool,
    pub elapsed_ms: u64,
    /// Set for a statement that returns no rows (INSERT, UPDATE, DDL…): how many rows it changed.
    pub rows_affected: Option<u64>,
}

#[derive(Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOp {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    StartsWith,
    /// Any of a comma-separated list.
    In,
    IsNull,
    NotNull,
}

/// A column of one of the tables in a browse: `table` 0 is the table being browsed,
/// 1 and on are its joins in order.
#[derive(Debug, PartialEq, Deserialize, Serialize)]
pub struct ColumnRef {
    #[serde(default)]
    pub table: usize,
    pub column: String,
}

/// One condition on a column of a browsed table (or a join, by `table`). `value` is
/// text, cast to the column's own type by the server, so `qty > 9` compares numbers,
/// not strings.
#[derive(Debug, PartialEq, Deserialize, Serialize)]
pub struct ColumnFilter {
    #[serde(default)]
    pub table: usize,
    pub column: String,
    pub op: FilterOp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JoinKind {
    /// Keeps every row of the tables before it, matched or not.
    Left,
    /// Keeps only rows that have a match.
    Inner,
}

/// One pair a join matches on: its own `column` equals `equals`, a column of a table
/// before it.
#[derive(Debug, Deserialize, Serialize)]
pub struct JoinOn {
    pub column: String,
    pub equals: ColumnRef,
}

/// A table joined into a browse, matched where every pair in `on` holds — more than one
/// for a foreign key over several columns.
#[derive(Debug, Deserialize, Serialize)]
pub struct TableJoin {
    pub schema: String,
    pub table: String,
    pub kind: JoinKind,
    pub on: Vec<JoinOn>,
}
