use crate::error::AppError;
use serde::Serialize;
use sqlparser::ast::{
    BinaryOperator, DataType, Expr, GroupByExpr, Ident, JoinConstraint, JoinOperator, LimitClause, ObjectName,
    OrderByKind, SelectItem, SelectItemQualifiedWildcardKind, SetExpr, Statement, TableAlias, TableFactor,
    TableWithJoins, UnaryOperator, Value,
};
use sqlparser::dialect::PostgreSqlDialect;
use sqlparser::parser::Parser;

use super::browse::{ColumnFilter, ColumnRef, FilterOp, JoinKind, JoinOn, TableJoin};

/// A table tab's SQL read back as the joins, filters, sort and page it was built from.
/// A column is named by its table's place: 0 for the browsed table, then each join.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSelect {
    pub joins: Vec<TableJoin>,
    /// The columns to show, in order; empty for every column.
    pub columns: Vec<ColumnRef>,
    pub filters: Vec<ColumnFilter>,
    pub order_by: Vec<ColumnRef>,
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

/// The tables a query reads — the browsed one, then each join — by the names SQL may
/// call them: its alias if it has one, else its own name, bare or schema-qualified.
struct Scope {
    names: Vec<Vec<String>>,
}

impl Scope {
    /// A column of one of the first `upto` tables. With joins it must be qualified,
    /// since which table a bare name belongs to takes the catalog to know.
    fn column_in(&self, expr: &Expr, upto: usize) -> Result<ColumnRef, String> {
        match expr {
            Expr::Identifier(ident) if self.names.len() == 1 => Ok(ColumnRef { table: 0, column: name(ident) }),
            Expr::Identifier(ident) => Err(format!("with joins, name \"{}\" by its table", name(ident))),
            Expr::CompoundIdentifier(parts) if parts.len() > 1 => {
                let (column, qualifier) = parts.split_last().expect("two or more parts");
                let qualifier = qualifier.iter().map(name).collect::<Vec<_>>().join(".");
                Ok(ColumnRef { table: self.table(&qualifier, upto)?, column: name(column) })
            }
            other => Err(format!("`{other}` isn't a plain column")),
        }
    }

    fn column(&self, expr: &Expr) -> Result<ColumnRef, String> {
        self.column_in(expr, self.names.len())
    }

    fn table(&self, qualifier: &str, upto: usize) -> Result<usize, String> {
        self.names[..upto]
            .iter()
            .position(|names| names.iter().any(|n| n == qualifier))
            .ok_or_else(|| format!("\"{qualifier}\" isn't a table this query can name there"))
    }
}

/// A plain table in FROM or a JOIN: its schema (the tab's when unqualified), name, and
/// the names it goes by.
fn table_named(relation: &TableFactor, default_schema: &str) -> Result<(String, String, Vec<String>), String> {
    let TableFactor::Table { name: object, alias, args: None, .. } = relation else {
        return Err(format!("`{relation}` isn't a plain table"));
    };
    let ObjectName(parts) = object;
    let parts: Vec<String> = parts.iter().filter_map(|p| p.as_ident()).map(name).collect();
    let (schema, table) = match parts.as_slice() {
        [table] => (default_schema.to_string(), table.clone()),
        [schema, table] => (schema.clone(), table.clone()),
        _ => return Err(format!("`{object}` isn't a table name")),
    };
    let names = match alias {
        Some(TableAlias { name: alias, columns, .. }) if columns.is_empty() => vec![name(alias)],
        Some(_) => return Err("a table alias can't rename columns here".to_string()),
        None => vec![table.clone(), format!("{schema}.{table}")],
    };
    Ok((schema, table, names))
}

/// A join's ON, as `own = earlier` column pairs joined by AND.
fn join_pairs(expr: &Expr, scope: &Scope, n: usize, out: &mut Vec<JoinOn>) -> Result<(), String> {
    match expr {
        Expr::Nested(inner) => join_pairs(inner, scope, n, out),
        Expr::BinaryOp { left, op: BinaryOperator::And, right } => {
            join_pairs(left, scope, n, out)?;
            join_pairs(right, scope, n, out)
        }
        Expr::BinaryOp { left, op: BinaryOperator::Eq, right } => {
            let (a, b) = (scope.column_in(left, n + 1)?, scope.column_in(right, n + 1)?);
            let (own, earlier) = if a.table == n { (a, b) } else { (b, a) };
            if own.table != n || earlier.table >= n {
                return Err("a join can only match its own columns to those of a table before it".to_string());
            }
            out.push(JoinOn { column: own.column, equals: earlier });
            Ok(())
        }
        other => Err(format!("`{other}` isn't a column = column match a join can show")),
    }
}

/// FROM this table and its JOIN … ON joins, with the scope naming them.
fn from_joins(from: &TableWithJoins, schema: &str, table: &str) -> Result<(Vec<TableJoin>, Scope), String> {
    let refused = || format!("only a query on {schema}.{table} and tables joined to it can be shown as its filters");
    let (main_schema, main_table, names) = table_named(&from.relation, schema).map_err(|_| refused())?;
    if (main_schema.as_str(), main_table.as_str()) != (schema, table) {
        return Err(refused());
    }
    let mut scope = Scope { names: vec![names] };
    let mut joined = Vec::new();
    for join in &from.joins {
        let (schema, table, names) = table_named(&join.relation, schema)?;
        let (kind, on) = match &join.join_operator {
            JoinOperator::Join(JoinConstraint::On(on)) | JoinOperator::Inner(JoinConstraint::On(on)) => (JoinKind::Inner, on),
            JoinOperator::Left(JoinConstraint::On(on)) | JoinOperator::LeftOuter(JoinConstraint::On(on)) => (JoinKind::Left, on),
            _ => return Err("only JOIN … ON and LEFT JOIN … ON can be shown as the builder's joins".to_string()),
        };
        scope.names.push(names);
        joined.push((schema, table, kind, on));
    }
    let mut joins = Vec::with_capacity(joined.len());
    for (i, (schema, table, kind, on)) in joined.into_iter().enumerate() {
        let mut pairs = Vec::new();
        join_pairs(on, &scope, i + 1, &mut pairs)?;
        joins.push(TableJoin { schema, table, kind, on: pairs });
    }
    Ok((joins, scope))
}

/// The projection's columns to show, or empty for every column: `*`, or with joins
/// each table's `t.*` in order.
fn shown_columns(projection: &[SelectItem], scope: &Scope) -> Result<Vec<ColumnRef>, String> {
    if let [SelectItem::Wildcard(_)] = projection {
        return Ok(Vec::new());
    }
    let every_table = projection.len() == scope.names.len()
        && projection.iter().enumerate().all(|(i, item)| match item {
            SelectItem::QualifiedWildcard(SelectItemQualifiedWildcardKind::ObjectName(object), _) => {
                let qualifier = object.0.iter().filter_map(|p| p.as_ident()).map(name).collect::<Vec<_>>().join(".");
                scope.table(&qualifier, scope.names.len()) == Ok(i)
            }
            _ => false,
        });
    if every_table {
        return Ok(Vec::new());
    }
    projection
        .iter()
        .map(|item| match item {
            SelectItem::UnnamedExpr(expr) => scope.column(expr),
            other => Err(format!("`{other}` isn't a plain column to show")),
        })
        .collect()
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

/// An ILIKE pattern back to its filter: `'%text%'` is contains, `'text%'` starts with,
/// with `\` escapes undone — refused if it holds any other wildcard.
fn like_filter(pattern: &Expr) -> Result<(FilterOp, String), String> {
    // Each character, and whether it's a wildcard (an unescaped `%` or `_`).
    let mut tokens = Vec::new();
    let quoted = literal(pattern)?;
    let mut chars = quoted.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => tokens.extend(chars.next().map(|c| (c, false))),
            c => tokens.push((c, c == '%' || c == '_')),
        }
    }
    let refused = || "only an ILIKE '%…%' or '…%' match can be a filter".to_string();
    let Some((&('%', true), body)) = tokens.split_last() else { return Err(refused()) };
    let (op, body) = match body.split_first() {
        Some((&('%', true), inner)) => (FilterOp::Contains, inner),
        _ => (FilterOp::StartsWith, body),
    };
    if body.is_empty() {
        return Err(refused());
    }
    if body.iter().any(|&(_, wild)| wild) {
        return Err("a wildcard inside ILIKE can't be a filter".to_string());
    }
    Ok((op, body.iter().map(|&(c, _)| c).collect()))
}

/// `IN (…)` back to an any-of filter's comma-separated text.
fn listed(list: &[Expr]) -> Result<String, String> {
    let values = list.iter().map(literal).collect::<Result<Vec<_>, _>>()?;
    if values.iter().any(|v| v.contains(',')) {
        return Err("a value holding a comma can't be one of an any-of filter's".to_string());
    }
    Ok(values.join(", "))
}

fn condition(expr: &Expr, scope: &Scope) -> Result<ColumnFilter, String> {
    let filter = |col: &Expr, op, value: Option<String>| {
        let ColumnRef { table, column } = scope.column(col)?;
        Ok(ColumnFilter { table, column, op, value })
    };
    let with_value = |col: &Expr, op, value: String| filter(col, op, Some(value));
    match expr {
        Expr::Nested(inner) => condition(inner, scope),
        Expr::IsNull(col) => filter(col, FilterOp::IsNull, None),
        Expr::IsNotNull(col) => filter(col, FilterOp::NotNull, None),
        Expr::ILike { negated: false, any: false, expr, pattern, escape_char: None } => {
            let col = match expr.as_ref() {
                Expr::Cast { expr, data_type: DataType::Text, .. } => expr.as_ref(),
                other => other,
            };
            let (op, text) = like_filter(pattern)?;
            with_value(col, op, text)
        }
        Expr::InList { expr, list, negated: false } => with_value(expr, FilterOp::In, listed(list)?),
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

fn conditions(expr: &Expr, scope: &Scope, out: &mut Vec<ColumnFilter>) -> Result<(), String> {
    match expr {
        Expr::BinaryOp { left, op: BinaryOperator::And, right } => {
            conditions(left, scope, out)?;
            conditions(right, scope, out)
        }
        other => condition(other, scope).map(|filter| out.push(filter)),
    }
}

fn integer(expr: &Expr) -> Result<i64, String> {
    literal(expr)?.parse().map_err(|_| "LIMIT and OFFSET must be whole numbers".to_string())
}

/// Reads `sql` as a filter view of `schema.table`: that table and any JOIN … ON joins,
/// `*` or plain columns, conditions joined by AND, one sort direction, and LIMIT/OFFSET. Anything else is
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
    let [from] = select.from.as_slice() else {
        return Err(format!("only a query on {schema}.{table} and tables joined to it can be shown as its filters"));
    };
    let (joins, scope) = from_joins(from, schema, table)?;
    let columns = shown_columns(&select.projection, &scope)?;

    let mut filters = Vec::new();
    if let Some(selection) = &select.selection {
        conditions(selection, &scope, &mut filters)?;
    }

    let mut order_by = Vec::new();
    let mut directions = Vec::new();
    if let Some(order) = &query.order_by {
        let OrderByKind::Expressions(exprs) = &order.kind else {
            return Err("ORDER BY ALL can't be shown as a sort".to_string());
        };
        for e in exprs {
            order_by.push(scope.column(&e.expr)?);
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

    Ok(TableSelect { joins, columns, filters, order_by, descending: directions.first() == Some(&true), limit, offset })
}

/// Reads a table tab's edited SQL back into its filters, sort and page, or says why
/// it can't be. Pure; no connection needed.
#[tauri::command(async)]
pub fn read_pg_table_select(sql: String, schema: String, table: String) -> Result<TableSelect, AppError> {
    read_table_select(&sql, &schema, &table).map_err(AppError::Sql)
}

#[cfg(test)]
#[path = "read_select.test.rs"]
mod tests;
