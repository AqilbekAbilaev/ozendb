use crate::error::AppError;
use serde::Serialize;
use sqlparser::ast::{
    Expr as SqlExpr, GroupByExpr, Ident, LimitClause, ObjectName, OrderBy, OrderByKind, Query,
    SelectItem, SetExpr, Statement, TableFactor, UnaryOperator, Value as SqlValue,
};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser as SqlParser;

mod filter;

// Translate a simple SQL SELECT into the pieces of a MongoDB find query, the way
// Studio-3T's "SQL Query" surface does. Parsing is delegated to the `sqlparser`
// crate; this module only walks the resulting AST and maps it to MQL. Scope is a
// single-table SELECT with WHERE / ORDER BY / LIMIT / OFFSET; aggregates, GROUP BY,
// HAVING, DISTINCT, and JOINs are intentionally out of scope and rejected with a
// clear message. Pure (no I/O), so it is fully unit-testable with no live connection.

#[derive(Serialize, Debug)]
pub struct MqlQuery {
    pub collection: String,
    // Pretty-printed JSON strings so the UI can drop them straight into the query
    // bar (filter / projection / sort) or render the equivalent shell command.
    pub filter: String,
    pub projection: String,
    pub sort: String,
    pub limit: Option<i64>,
    pub skip: Option<i64>,
}

// ── Ordered JSON value ─────────────────────────────────────────────
// serde_json::Value orders object keys alphabetically without the preserve_order
// feature, which would corrupt multi-key sort documents (ORDER BY b, a). This
// small ordered emitter keeps insertion order so output is faithful and tests are
// deterministic.
enum J {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

fn json_string(value: &str) -> String {
    match serde_json::to_string(value) {
        Ok(val) => val,
        Err(_) => format!("\"{value}\""),
    }
}

impl J {
    fn to_pretty(&self, level: usize) -> String {
        let pad = "  ".repeat(level);
        let pad1 = "  ".repeat(level + 1);
        match self {
            J::Null => "null".to_string(),
            J::Bool(value) => value.to_string(),
            J::Int(value) => value.to_string(),
            J::Float(value) => match serde_json::Number::from_f64(*value) {
                Some(num) => num.to_string(),
                None => "null".to_string(),
            },
            J::Str(value) => json_string(value),
            J::Arr(items) => {
                if items.is_empty() {
                    return "[]".to_string();
                }
                let inner: Vec<String> = items
                    .iter()
                    .map(|item| format!("{pad1}{}", item.to_pretty(level + 1)))
                    .collect();
                format!("[\n{}\n{pad}]", inner.join(",\n"))
            }
            J::Obj(entries) => {
                if entries.is_empty() {
                    return "{}".to_string();
                }
                let inner: Vec<String> = entries
                    .iter()
                    .map(|(key, value)| {
                        format!("{pad1}{}: {}", json_string(key), value.to_pretty(level + 1))
                    })
                    .collect();
                format!("{{\n{}\n{pad}}}", inner.join(",\n"))
            }
        }
    }
}

// ── SQL AST → our expression tree ──────────────────────────────────
// `SKIP <n>` is a non-standard alias we accept for `OFFSET <n>` (sqlparser doesn't
// know it), so rewrite the bare keyword to OFFSET before parsing. Only whole-word,
// case-insensitive matches outside string literals are touched.
fn normalize_skip(sql: &str) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0;
    let mut in_str: Option<char> = None;
    while i < chars.len() {
        let c = chars[i];
        if let Some(quote) = in_str {
            out.push(c);
            if c == quote {
                in_str = None;
            }
            i += 1;
            continue;
        }
        if c == '\'' || c == '"' {
            in_str = Some(c);
            out.push(c);
            i += 1;
            continue;
        }
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            if word.eq_ignore_ascii_case("skip") {
                out.push_str("OFFSET");
            } else {
                out.push_str(&word);
            }
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

fn join_idents(parts: &[Ident]) -> String {
    parts
        .iter()
        .map(|ident| ident.value.clone())
        .collect::<Vec<String>>()
        .join(".")
}

fn object_name_to_string(name: &ObjectName) -> String {
    name.0
        .iter()
        .filter_map(|part| part.as_ident())
        .map(|ident| ident.value.clone())
        .collect::<Vec<String>>()
        .join(".")
}

// A field reference: a bare column or a dotted path (address.city).
fn ident_field(expr: &SqlExpr) -> Result<String, String> {
    match expr {
        SqlExpr::Identifier(ident) => Ok(ident.value.clone()),
        SqlExpr::CompoundIdentifier(parts) => Ok(join_idents(parts)),
        other => Err(format!("Expected a field name, found `{other}`")),
    }
}

fn value_from_value(value: &SqlValue) -> Result<J, String> {
    match value {
        SqlValue::Number(text, _) => {
            if text.contains('.') {
                match text.parse::<f64>() {
                    Ok(num) => Ok(J::Float(num)),
                    Err(_) => Err(format!("Invalid number: {text}")),
                }
            } else {
                match text.parse::<i64>() {
                    Ok(num) => Ok(J::Int(num)),
                    Err(_) => Err(format!("Invalid number: {text}")),
                }
            }
        }
        SqlValue::SingleQuotedString(text) | SqlValue::DoubleQuotedString(text) => {
            Ok(J::Str(text.clone()))
        }
        SqlValue::Boolean(flag) => Ok(J::Bool(*flag)),
        SqlValue::Null => Ok(J::Null),
        other => Err(format!("Unsupported value: {other}")),
    }
}

fn value_from_expr(expr: &SqlExpr) -> Result<J, String> {
    match expr {
        SqlExpr::Value(value) => value_from_value(&value.value),
        SqlExpr::UnaryOp { op: UnaryOperator::Minus, expr } => match value_from_expr(expr) {
            Ok(J::Int(num)) => Ok(J::Int(-num)),
            Ok(J::Float(num)) => Ok(J::Float(-num)),
            Ok(_) => Err("Cannot negate a non-numeric value".to_string()),
            Err(e) => Err(e),
        },
        SqlExpr::UnaryOp { op: UnaryOperator::Plus, expr } => value_from_expr(expr),
        other => Err(format!("Expected a value, found `{other}`")),
    }
}

fn convert_projection(items: &[SelectItem]) -> Result<Vec<(String, J)>, String> {
    let mut out: Vec<(String, J)> = Vec::new();
    for item in items {
        match item {
            // SELECT * → all fields, i.e. an empty projection.
            SelectItem::Wildcard(_) => return Ok(Vec::new()),
            SelectItem::UnnamedExpr(expr) => {
                let field = match projection_field(expr) {
                    Ok(val) => val,
                    Err(e) => return Err(e),
                };
                out.push((field, J::Int(1)));
            }
            // `AS alias` is accepted and ignored (projection uses the source field).
            SelectItem::ExprWithAlias { expr, alias: _ } => {
                let field = match projection_field(expr) {
                    Ok(val) => val,
                    Err(e) => return Err(e),
                };
                out.push((field, J::Int(1)));
            }
            other => return Err(format!("Unsupported SELECT item: `{other}`")),
        }
    }
    Ok(out)
}

fn projection_field(expr: &SqlExpr) -> Result<String, String> {
    match expr {
        SqlExpr::Identifier(ident) => Ok(ident.value.clone()),
        SqlExpr::CompoundIdentifier(parts) => Ok(join_idents(parts)),
        SqlExpr::Function(_) => Err(
            "Aggregate/function projection is not supported yet — only plain column selection"
                .to_string(),
        ),
        other => Err(format!("Only plain column names are supported in SELECT, found `{other}`")),
    }
}

fn convert_from(from: &[sqlparser::ast::TableWithJoins]) -> Result<String, String> {
    if from.len() != 1 {
        return Err("Expected exactly one table in FROM".to_string());
    }
    let table = &from[0];
    if !table.joins.is_empty() {
        return Err("JOINs are not supported yet".to_string());
    }
    match &table.relation {
        TableFactor::Table { name, alias, args, .. } => {
            if alias.is_some() {
                return Err("Table aliases are not supported".to_string());
            }
            if args.is_some() {
                return Err("Table-valued functions are not supported".to_string());
            }
            Ok(object_name_to_string(name))
        }
        _ => Err("Unsupported table expression in FROM".to_string()),
    }
}

fn convert_order_by(order_by: &Option<OrderBy>) -> Result<Vec<(String, J)>, String> {
    let mut out: Vec<(String, J)> = Vec::new();
    let order_by = match order_by {
        Some(val) => val,
        None => return Ok(out),
    };
    match &order_by.kind {
        OrderByKind::Expressions(exprs) => {
            for order_expr in exprs {
                let field = match ident_field(&order_expr.expr) {
                    Ok(val) => val,
                    Err(e) => return Err(e),
                };
                // asc == Some(false) means DESC; ASC or unspecified is ascending.
                let dir = if order_expr.options.asc == Some(false) { -1 } else { 1 };
                out.push((field, J::Int(dir)));
            }
        }
        OrderByKind::All(_) => return Err("ORDER BY ALL is not supported".to_string()),
    }
    Ok(out)
}

fn expect_int(expr: &SqlExpr) -> Result<i64, String> {
    match value_from_expr(expr) {
        Ok(J::Int(num)) => Ok(num),
        Ok(_) => Err("Expected an integer".to_string()),
        Err(e) => Err(e),
    }
}

fn convert_limit(limit_clause: &Option<LimitClause>) -> Result<(Option<i64>, Option<i64>), String> {
    match limit_clause {
        None => Ok((None, None)),
        Some(LimitClause::LimitOffset { limit, offset, limit_by }) => {
            if !limit_by.is_empty() {
                return Err("LIMIT BY is not supported".to_string());
            }
            let limit_val = match limit {
                Some(expr) => match expect_int(expr) {
                    Ok(val) => Some(val),
                    Err(e) => return Err(e),
                },
                None => None,
            };
            let skip_val = match offset {
                Some(off) => match expect_int(&off.value) {
                    Ok(val) => Some(val),
                    Err(e) => return Err(e),
                },
                None => None,
            };
            Ok((limit_val, skip_val))
        }
        Some(LimitClause::OffsetCommaLimit { .. }) => {
            Err("`LIMIT offset, count` syntax is not supported".to_string())
        }
    }
}

// ── Top-level translate ────────────────────────────────────────────
pub(crate) fn sql_to_mql(sql: &str) -> Result<MqlQuery, String> {
    let normalized = normalize_skip(sql);
    let dialect = GenericDialect {};
    let statements = match SqlParser::parse_sql(&dialect, &normalized) {
        Ok(val) => val,
        Err(e) => return Err(format!("{e}")),
    };
    if statements.len() != 1 {
        return Err("Expected a single SELECT statement".to_string());
    }
    let statement = match statements.into_iter().next() {
        Some(val) => val,
        None => return Err("Empty query".to_string()),
    };
    let query: Query = match statement {
        Statement::Query(query) => *query,
        _ => return Err("Only SELECT queries are supported".to_string()),
    };

    let Query { body, order_by, limit_clause, .. } = query;
    let select = match *body {
        SetExpr::Select(select) => *select,
        _ => return Err("Only simple SELECT queries are supported".to_string()),
    };

    // sqlparser's generic dialect accepts a SELECT-less `FROM t` (a DuckDB/ClickHouse
    // shorthand); we require an explicit SELECT, so an empty projection list is rejected.
    if select.projection.is_empty() {
        return Err("Query must start with SELECT".to_string());
    }
    if select.distinct.is_some() {
        return Err("DISTINCT is not supported yet".to_string());
    }
    if select.having.is_some() {
        return Err("HAVING is not supported yet".to_string());
    }
    match &select.group_by {
        GroupByExpr::Expressions(exprs, _) if exprs.is_empty() => {}
        _ => return Err("GROUP BY is not supported yet".to_string()),
    }

    let projection = match convert_projection(&select.projection) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let collection = match convert_from(&select.from) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let filter = match &select.selection {
        Some(expr) => match filter::convert_where(expr) {
            Ok(val) => filter::expr_to_j(val),
            Err(e) => return Err(e),
        },
        None => J::Obj(Vec::new()),
    };
    let sort = match convert_order_by(&order_by) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let (limit, skip) = match convert_limit(&limit_clause) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };

    Ok(MqlQuery {
        collection: collection,
        filter: filter.to_pretty(0),
        projection: J::Obj(projection).to_pretty(0),
        sort: J::Obj(sort).to_pretty(0),
        limit: limit,
        skip: skip,
    })
}

/// Translate a SQL SELECT statement into the parts of an equivalent MongoDB find
/// query. Pure and connection-free.
#[tauri::command]
pub fn translate_sql(sql: String) -> Result<MqlQuery, AppError> {
    match sql_to_mql(&sql) {
        Ok(val) => Ok(val),
        Err(message) => Err(AppError::Sql(message)),
    }
}

#[cfg(test)]
#[path = "sql.test.rs"]
mod tests;
