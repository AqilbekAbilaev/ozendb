use crate::error::AppError;
use serde::Serialize;
use sqlparser::ast::{
    BinaryOperator, DataType, Expr, GroupByExpr, Ident, LimitClause, OrderByKind, SelectItem, SetExpr,
    Statement, TableFactor, UnaryOperator, Value,
};
use sqlparser::dialect::PostgreSqlDialect;
use sqlparser::parser::Parser;

use super::browse::{ColumnFilter, FilterOp};

/// A table tab's SQL read back as the filters, sort and page it was built from.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSelect {
    /// The columns to show, in order; empty for `SELECT *`.
    pub columns: Vec<String>,
    pub filters: Vec<ColumnFilter>,
    pub order_by: Vec<String>,
    pub descending: bool,
    pub limit: Option<i64>,
    pub offset: i64,
}

/// Postgres folds an unquoted name to lower case; a quoted one is taken as written.
fn name(ident: &Ident) -> String {
    match ident.quote_style {
        Some(_) => ident.value.clone(),
        None => ident.value.to_lowercase(),
    }
}

fn column(expr: &Expr) -> Result<String, String> {
    match expr {
        Expr::Identifier(ident) => Ok(name(ident)),
        other => Err(format!("`{other}` isn't a plain column")),
    }
}

/// A literal as the text a filter box would hold.
fn literal(expr: &Expr) -> Result<String, String> {
    match expr {
        Expr::Value(v) => match &v.value {
            Value::SingleQuotedString(text) | Value::Number(text, _) => Ok(text.clone()),
            Value::Boolean(flag) => Ok(flag.to_string()),
            other => Err(format!("`{other}` isn't a value a filter can hold")),
        },
        Expr::UnaryOp { op: UnaryOperator::Minus, expr } => literal(expr).map(|text| format!("-{text}")),
        other => Err(format!("`{other}` isn't a plain value")),
    }
}

/// `'%text%'` with `\` escapes, back to `text` — refused if it holds a real wildcard.
fn contains_text(pattern: &Expr) -> Result<String, String> {
    let quoted = literal(pattern)?;
    let inner = match quoted.strip_prefix('%').and_then(|rest| rest.strip_suffix('%')) {
        Some(inner) => inner,
        None => return Err("only an ILIKE '%…%' match can be a contains filter".to_string()),
    };
    let mut out = String::new();
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => out.extend(chars.next()),
            '%' | '_' => return Err("a wildcard inside ILIKE can't be a contains filter".to_string()),
            c => out.push(c),
        }
    }
    Ok(out)
}

fn condition(expr: &Expr) -> Result<ColumnFilter, String> {
    let with_value = |col: &Expr, op, value: String| Ok(ColumnFilter { column: column(col)?, op, value: Some(value) });
    match expr {
        Expr::Nested(inner) => condition(inner),
        Expr::IsNull(col) => Ok(ColumnFilter { column: column(col)?, op: FilterOp::IsNull, value: None }),
        Expr::IsNotNull(col) => Ok(ColumnFilter { column: column(col)?, op: FilterOp::NotNull, value: None }),
        Expr::ILike { negated: false, any: false, expr, pattern, escape_char: None } => {
            let col = match expr.as_ref() {
                Expr::Cast { expr, data_type: DataType::Text, .. } => expr.as_ref(),
                other => other,
            };
            with_value(col, FilterOp::Contains, contains_text(pattern)?)
        }
        Expr::BinaryOp { left, op, right } => {
            let op = match op {
                BinaryOperator::Eq => FilterOp::Eq,
                BinaryOperator::NotEq => FilterOp::Ne,
                BinaryOperator::Gt => FilterOp::Gt,
                BinaryOperator::GtEq => FilterOp::Gte,
                BinaryOperator::Lt => FilterOp::Lt,
                BinaryOperator::LtEq => FilterOp::Lte,
                other => return Err(format!("`{other}` has no filter box equivalent")),
            };
            with_value(left, op, literal(right)?)
        }
        other => Err(format!("`{other}` has no filter box equivalent")),
    }
}

fn conditions(expr: &Expr, out: &mut Vec<ColumnFilter>) -> Result<(), String> {
    match expr {
        Expr::BinaryOp { left, op: BinaryOperator::And, right } => {
            conditions(left, out)?;
            conditions(right, out)
        }
        other => condition(other).map(|filter| out.push(filter)),
    }
}

fn integer(expr: &Expr) -> Result<i64, String> {
    literal(expr)?.parse().map_err(|_| "LIMIT and OFFSET must be whole numbers".to_string())
}

/// Reads `sql` as a filter view of `schema.table`: `*` or plain columns from that one table,
/// conditions joined by AND, one sort direction, and LIMIT/OFFSET. Anything else is
/// refused with the reason, since the filter boxes couldn't show it.
pub(crate) fn read_table_select(sql: &str, schema: &str, table: &str) -> Result<TableSelect, String> {
    let statements = Parser::parse_sql(&PostgreSqlDialect {}, sql).map_err(|e| e.to_string())?;
    let [Statement::Query(query)] = statements.as_slice() else {
        return Err("only a single SELECT can be shown as filters".to_string());
    };
    let SetExpr::Select(select) = query.body.as_ref() else {
        return Err("only a plain SELECT can be shown as filters".to_string());
    };
    let plain = query.with.is_none()
        && select.distinct.is_none()
        && select.having.is_none()
        && matches!(&select.group_by, GroupByExpr::Expressions(e, _) if e.is_empty());
    if !plain {
        return Err("only a SELECT with WHERE, ORDER BY and LIMIT can be shown as filters".to_string());
    }
    let columns = match select.projection.as_slice() {
        [SelectItem::Wildcard(_)] => Vec::new(),
        items => items
            .iter()
            .map(|item| match item {
                SelectItem::UnnamedExpr(expr) => column(expr),
                other => Err(format!("`{other}` isn't a plain column to show")),
            })
            .collect::<Result<_, _>>()?,
    };

    let from_this_table = match select.from.as_slice() {
        [from] if from.joins.is_empty() => match &from.relation {
            TableFactor::Table { name: object, alias: None, args: None, .. } => {
                let parts: Vec<String> = object.0.iter().filter_map(|p| p.as_ident()).map(name).collect();
                parts == [table] || parts == [schema, table]
            }
            _ => false,
        },
        _ => false,
    };
    if !from_this_table {
        return Err(format!("only a query on {schema}.{table} alone can be shown as its filters"));
    }

    let mut filters = Vec::new();
    if let Some(selection) = &select.selection {
        conditions(selection, &mut filters)?;
    }

    let mut order_by = Vec::new();
    let mut directions = Vec::new();
    if let Some(order) = &query.order_by {
        let OrderByKind::Expressions(exprs) = &order.kind else {
            return Err("ORDER BY ALL can't be shown as a sort".to_string());
        };
        for e in exprs {
            order_by.push(column(&e.expr)?);
            directions.push(e.options.asc == Some(false));
        }
    }
    if directions.windows(2).any(|pair| pair[0] != pair[1]) {
        return Err("the grid sorts every column in one direction".to_string());
    }

    let (limit, offset) = match &query.limit_clause {
        None => (None, 0),
        Some(LimitClause::LimitOffset { limit, offset, limit_by }) if limit_by.is_empty() => (
            limit.as_ref().map(integer).transpose()?,
            offset.as_ref().map(|o| integer(&o.value)).transpose()?.unwrap_or(0),
        ),
        Some(_) => return Err("only LIMIT n OFFSET m paging can be shown".to_string()),
    };

    Ok(TableSelect { columns, filters, order_by, descending: directions.first() == Some(&true), limit, offset })
}

/// Reads a table tab's edited SQL back into its filters, sort and page, or says why
/// it can't be. Pure; no connection needed.
#[tauri::command]
pub fn read_pg_table_select(sql: String, schema: String, table: String) -> Result<TableSelect, AppError> {
    read_table_select(&sql, &schema, &table).map_err(AppError::Sql)
}

#[cfg(test)]
#[path = "read_select.test.rs"]
mod tests;
