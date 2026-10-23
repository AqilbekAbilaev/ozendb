use super::{order_clause, where_clause};
use crate::commands::mysql::MySqlColumnInfo;
use crate::commands::sql::{ColumnFilter, FilterOp};
use crate::error::AppError;

fn columns() -> Vec<MySqlColumnInfo> {
    [("id `key`", "bigint unsigned", true), ("price €", "decimal(10,2)", false), ("name", "varchar(80)", false), ("at", "datetime(6)", false), ("ratio", "double", false)]
        .into_iter()
        .map(|(name, data_type, is_primary_key)| MySqlColumnInfo {
            name: name.to_string(),
            data_type: data_type.to_string(),
            nullable: true,
            is_primary_key,
            default: None,
            references: None,
        })
        .collect()
}

fn filter(column: &str, op: FilterOp, value: Option<&str>) -> ColumnFilter {
    ColumnFilter { table: 0, column: column.to_string(), op, value: value.map(str::to_string) }
}

fn clause(filters: &[ColumnFilter]) -> (String, Vec<String>) {
    where_clause(filters, &columns()).unwrap()
}

#[test]
fn no_filters_add_no_where_clause() {
    assert_eq!(clause(&[]), (String::new(), vec![]));
}

#[test]
fn compares_exact_numbers_as_a_wide_decimal() {
    let (sql, binds) = clause(&[filter("id `key`", FilterOp::Gte, Some("18446744073709551615")), filter("price €", FilterOp::Lt, Some("9.99"))]);
    assert_eq!(sql, " WHERE `id ``key``` >= CAST(? AS DECIMAL(65,30)) AND `price €` < CAST(? AS DECIMAL(65,30))");
    assert_eq!(binds, vec!["18446744073709551615", "9.99"]);
}

#[test]
fn compares_text_dates_and_floats_against_the_bound_value_as_it_is() {
    let (sql, binds) = clause(&[filter("name", FilterOp::Ne, Some("a'b")), filter("at", FilterOp::Gt, Some("2024-02-29")), filter("ratio", FilterOp::Eq, Some("0.5"))]);
    assert_eq!(sql, " WHERE `name` <> ? AND `at` > ? AND `ratio` = ?");
    assert_eq!(binds, vec!["a'b", "2024-02-29", "0.5"]);
}

#[test]
fn contains_matches_the_text_form_ignoring_case_with_wildcards_escaped() {
    let (sql, binds) = clause(&[filter("name", FilterOp::Contains, Some("50%_off\\"))]);
    assert_eq!(sql, " WHERE CONVERT(`name` USING utf8mb4) COLLATE utf8mb4_general_ci LIKE CONCAT('%', ?, '%')");
    assert_eq!(binds, vec!["50\\%\\_off\\\\"]);
}

#[test]
fn starts_with_matches_the_start_of_the_text_form() {
    let (sql, binds) = clause(&[filter("id `key`", FilterOp::StartsWith, Some("12"))]);
    assert_eq!(sql, " WHERE CONVERT(`id ``key``` USING utf8mb4) COLLATE utf8mb4_general_ci LIKE CONCAT(?, '%')");
    assert_eq!(binds, vec!["12"]);
}

#[test]
fn any_of_binds_each_trimmed_value() {
    let (sql, binds) = clause(&[filter("id `key`", FilterOp::In, Some(" 1, 2 ,,3")), filter("name", FilterOp::In, Some("a,b"))]);
    assert_eq!(sql, " WHERE `id ``key``` IN (CAST(? AS DECIMAL(65,30)), CAST(? AS DECIMAL(65,30)), CAST(? AS DECIMAL(65,30))) AND `name` IN (?, ?)");
    assert_eq!(binds, vec!["1", "2", "3", "a", "b"]);
}

#[test]
fn null_checks_bind_nothing() {
    let (sql, binds) = clause(&[filter("name", FilterOp::IsNull, None), filter("at", FilterOp::NotNull, None)]);
    assert_eq!(sql, " WHERE `name` IS NULL AND `at` IS NOT NULL");
    assert!(binds.is_empty());
}

#[test]
fn refuses_an_unknown_column_a_missing_value_an_empty_list_and_a_joined_table() {
    let refused = |f: ColumnFilter| matches!(where_clause(&[f], &columns()), Err(AppError::Validation(_)));
    assert!(refused(filter("nope", FilterOp::Eq, Some("1"))));
    assert!(refused(filter("name", FilterOp::Eq, None)));
    assert!(refused(filter("name", FilterOp::In, Some(" , "))));
    assert!(refused(ColumnFilter { table: 1, ..filter("name", FilterOp::IsNull, None) }));
}

#[test]
fn orders_by_the_chosen_column_or_else_the_primary_key() {
    assert_eq!(order_clause(Some("name"), true, &columns()).unwrap(), " ORDER BY `name` DESC");
    assert_eq!(order_clause(None, false, &columns()).unwrap(), " ORDER BY `id ``key``` ASC");
    assert_eq!(order_clause(Some(""), false, &columns()).unwrap(), " ORDER BY `id ``key``` ASC");
}

#[test]
fn leaves_a_table_without_a_primary_key_unordered() {
    let keyless: Vec<_> = columns().into_iter().filter(|c| !c.is_primary_key).collect();
    assert_eq!(order_clause(None, false, &keyless).unwrap(), "");
}

#[test]
fn refuses_to_order_by_a_column_the_table_lacks() {
    assert!(matches!(order_clause(Some("nope"), false, &columns()), Err(AppError::Validation(_))));
}
