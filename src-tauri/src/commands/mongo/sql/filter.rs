use sqlparser::ast::{BinaryOperator, Expr as SqlExpr};

use super::{ident_field, value_from_expr, J};

pub(super) enum Cond {
    Eq(J),
    Ne(J),
    Lt(J),
    Lte(J),
    Gt(J),
    Gte(J),
    In(Vec<J>),
    Nin(Vec<J>),
    Regex(String),
    NotRegex(String),
    Between(J, J),
    IsNull,
    IsNotNull,
}

pub(super) enum Expr {
    And(Vec<Expr>),
    Or(Vec<Expr>),
    Leaf(String, Cond),
}

fn like_to_regex(pattern: &str) -> String {
    let mut out = String::from("^");
    for ch in pattern.chars() {
        match ch {
            '%' => out.push_str(".*"),
            '_' => out.push('.'),
            '.' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '^' | '$' | '|' | '\\' => {
                out.push('\\');
                out.push(ch);
            }
            other => out.push(other),
        }
    }
    out.push('$');
    out
}

fn cond_to_j(cond: Cond) -> J {
    match cond {
        Cond::Eq(value) => value,
        Cond::Ne(value) => J::Obj(vec![("$ne".to_string(), value)]),
        Cond::Lt(value) => J::Obj(vec![("$lt".to_string(), value)]),
        Cond::Lte(value) => J::Obj(vec![("$lte".to_string(), value)]),
        Cond::Gt(value) => J::Obj(vec![("$gt".to_string(), value)]),
        Cond::Gte(value) => J::Obj(vec![("$gte".to_string(), value)]),
        Cond::In(values) => J::Obj(vec![("$in".to_string(), J::Arr(values))]),
        Cond::Nin(values) => J::Obj(vec![("$nin".to_string(), J::Arr(values))]),
        Cond::Regex(pattern) => J::Obj(vec![("$regex".to_string(), J::Str(pattern))]),
        Cond::NotRegex(pattern) => J::Obj(vec![(
            "$not".to_string(),
            J::Obj(vec![("$regex".to_string(), J::Str(pattern))]),
        )]),
        Cond::Between(low, high) => {
            J::Obj(vec![("$gte".to_string(), low), ("$lte".to_string(), high)])
        }
        Cond::IsNull => J::Null,
        Cond::IsNotNull => J::Obj(vec![("$ne".to_string(), J::Null)]),
    }
}

fn can_merge(parts: &[J]) -> bool {
    let mut keys: Vec<&str> = Vec::new();
    for part in parts {
        match part {
            J::Obj(entries) if entries.len() == 1 => {
                let key = entries[0].0.as_str();
                if keys.iter().any(|existing| *existing == key) {
                    return false;
                }
                keys.push(key);
            }
            _ => return false,
        }
    }
    true
}

pub(super) fn expr_to_j(expr: Expr) -> J {
    match expr {
        Expr::Leaf(field, cond) => J::Obj(vec![(field, cond_to_j(cond))]),
        Expr::Or(children) => {
            let parts: Vec<J> = children.into_iter().map(expr_to_j).collect();
            J::Obj(vec![("$or".to_string(), J::Arr(parts))])
        }
        Expr::And(children) => {
            let parts: Vec<J> = children.into_iter().map(expr_to_j).collect();
            if can_merge(&parts) {
                let mut merged: Vec<(String, J)> = Vec::new();
                for part in parts {
                    if let J::Obj(entries) = part {
                        for entry in entries {
                            merged.push(entry);
                        }
                    }
                }
                J::Obj(merged)
            } else {
                J::Obj(vec![("$and".to_string(), J::Arr(parts))])
            }
        }
    }
}

fn string_literal(expr: &SqlExpr) -> Result<String, String> {
    match value_from_expr(expr) {
        Ok(J::Str(text)) => Ok(text),
        Ok(_) => Err("Expected a pattern string".to_string()),
        Err(e) => Err(e),
    }
}

fn convert_leaf(expr: &SqlExpr) -> Result<Expr, String> {
    match expr {
        SqlExpr::Nested(inner) => convert_leaf(inner),
        SqlExpr::IsNull(inner) => ident_field(inner).map(|field| Expr::Leaf(field, Cond::IsNull)),
        SqlExpr::IsNotNull(inner) => {
            ident_field(inner).map(|field| Expr::Leaf(field, Cond::IsNotNull))
        }
        SqlExpr::Like { negated, any, expr: field_expr, pattern, .. } => {
            if *any {
                return Err("LIKE ANY is not supported".to_string());
            }
            let field = ident_field(field_expr)?;
            let regex = like_to_regex(&string_literal(pattern)?);
            let cond = if *negated { Cond::NotRegex(regex) } else { Cond::Regex(regex) };
            Ok(Expr::Leaf(field, cond))
        }
        SqlExpr::InList { expr: field_expr, list, negated } => {
            let field = ident_field(field_expr)?;
            if list.is_empty() {
                return Err("IN list cannot be empty".to_string());
            }
            let values = list
                .iter()
                .map(value_from_expr)
                .collect::<Result<Vec<J>, String>>()?;
            let cond = if *negated { Cond::Nin(values) } else { Cond::In(values) };
            Ok(Expr::Leaf(field, cond))
        }
        SqlExpr::Between { expr: field_expr, negated, low, high } => {
            if *negated {
                return Err("NOT BETWEEN is not supported yet".to_string());
            }
            Ok(Expr::Leaf(
                ident_field(field_expr)?,
                Cond::Between(value_from_expr(low)?, value_from_expr(high)?),
            ))
        }
        SqlExpr::BinaryOp { left, op, right } => {
            let field = ident_field(left)?;
            let value = value_from_expr(right)?;
            let cond = match op {
                BinaryOperator::Eq => Cond::Eq(value),
                BinaryOperator::NotEq => Cond::Ne(value),
                BinaryOperator::Lt => Cond::Lt(value),
                BinaryOperator::LtEq => Cond::Lte(value),
                BinaryOperator::Gt => Cond::Gt(value),
                BinaryOperator::GtEq => Cond::Gte(value),
                other => return Err(format!("Unsupported operator `{other}`")),
            };
            Ok(Expr::Leaf(field, cond))
        }
        other => Err(format!("Unsupported condition: `{other}`")),
    }
}

fn flatten_bool(expr: &SqlExpr, op: &BinaryOperator, out: &mut Vec<Expr>) -> Result<(), String> {
    match expr {
        SqlExpr::BinaryOp { left, op: inner, right } if inner == op => {
            flatten_bool(left, op, out)?;
            flatten_bool(right, op, out)
        }
        other => {
            out.push(convert_where(other)?);
            Ok(())
        }
    }
}

pub(super) fn convert_where(expr: &SqlExpr) -> Result<Expr, String> {
    match expr {
        SqlExpr::Nested(inner) => convert_where(inner),
        SqlExpr::BinaryOp { left, op: BinaryOperator::And, right } => {
            let mut parts = Vec::new();
            flatten_bool(left, &BinaryOperator::And, &mut parts)?;
            flatten_bool(right, &BinaryOperator::And, &mut parts)?;
            Ok(Expr::And(parts))
        }
        SqlExpr::BinaryOp { left, op: BinaryOperator::Or, right } => {
            let mut parts = Vec::new();
            flatten_bool(left, &BinaryOperator::Or, &mut parts)?;
            flatten_bool(right, &BinaryOperator::Or, &mut parts)?;
            Ok(Expr::Or(parts))
        }
        other => convert_leaf(other),
    }
}
