use super::{where_clause, ColumnFilter, FilterOp};
use crate::error::AppError;
use std::collections::BTreeMap;

fn types() -> BTreeMap<String, String> {
    [("qty", "integer"), ("name", "text"), ("at", "timestamp with time zone")]
        .into_iter()
        .map(|(n, t)| (n.to_string(), t.to_string()))
        .collect()
}

fn filter(column: &str, op: FilterOp, value: Option<&str>) -> ColumnFilter {
    ColumnFilter { column: column.to_string(), op, value: value.map(str::to_string) }
}

#[test]
fn no_filters_add_no_where_clause() {
    assert_eq!(where_clause(&[], &types()).unwrap(), (String::new(), vec![]));
}

#[test]
fn comparisons_bind_the_value_cast_to_the_column_type() {
    let (sql, binds) = where_clause(&[filter("qty", FilterOp::Gte, Some("5"))], &types()).unwrap();
    assert_eq!(sql, " WHERE \"qty\" >= $1::integer");
    assert_eq!(binds, vec!["5"]);
}

#[test]
fn contains_matches_the_text_form_with_wildcards_escaped() {
    let (sql, binds) = where_clause(&[filter("name", FilterOp::Contains, Some("50%_off\\"))], &types()).unwrap();
    assert_eq!(sql, " WHERE \"name\"::text ILIKE '%' || $1 || '%'");
    assert_eq!(binds, vec!["50\\%\\_off\\\\"]);
}

#[test]
fn null_checks_take_no_value_and_filters_combine_with_and() {
    let (sql, binds) = where_clause(
        &[filter("at", FilterOp::IsNull, None), filter("qty", FilterOp::Ne, Some("0")), filter("name", FilterOp::NotNull, None)],
        &types(),
    )
    .unwrap();
    assert_eq!(sql, " WHERE \"at\" IS NULL AND \"qty\" <> $1::integer AND \"name\" IS NOT NULL");
    assert_eq!(binds, vec!["0"]);
}

#[test]
fn an_unknown_column_or_a_missing_value_is_refused() {
    let unknown = where_clause(&[filter("nope", FilterOp::Eq, Some("1"))], &types());
    assert!(matches!(unknown, Err(AppError::Validation(_))));
    let missing = where_clause(&[filter("qty", FilterOp::Lt, None)], &types());
    assert!(matches!(missing, Err(AppError::Validation(_))));
}
