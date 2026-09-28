use super::{from_clause, where_clause, ColumnFilter, ColumnRef, FilterOp, JoinKind, JoinOn, TableJoin};
use crate::error::AppError;
use std::collections::BTreeMap;

fn types() -> BTreeMap<String, String> {
    [("qty", "integer"), ("name", "text"), ("at", "timestamp with time zone")]
        .into_iter()
        .map(|(n, t)| (n.to_string(), t.to_string()))
        .collect()
}

fn joined_types() -> BTreeMap<String, String> {
    [("id", "bigint"), ("name", "text")].into_iter().map(|(n, t)| (n.to_string(), t.to_string())).collect()
}

fn filter(column: &str, op: FilterOp, value: Option<&str>) -> ColumnFilter {
    ColumnFilter { table: 0, column: column.to_string(), op, value: value.map(str::to_string) }
}

fn join(table: &str, kind: JoinKind, column: &str, equals: (usize, &str)) -> TableJoin {
    TableJoin {
        schema: String::from("public"),
        table: table.to_string(),
        kind,
        on: vec![JoinOn { column: column.to_string(), equals: ColumnRef { table: equals.0, column: equals.1.to_string() } }],
    }
}

#[test]
fn no_filters_add_no_where_clause() {
    assert_eq!(where_clause(&[], &[types()]).unwrap(), (String::new(), vec![]));
}

#[test]
fn comparisons_bind_the_value_cast_to_the_column_type() {
    let (sql, binds) = where_clause(&[filter("qty", FilterOp::Gte, Some("5"))], &[types()]).unwrap();
    assert_eq!(sql, " WHERE \"t0\".\"qty\" >= $1::integer");
    assert_eq!(binds, vec!["5"]);
}

#[test]
fn contains_matches_the_text_form_with_wildcards_escaped() {
    let (sql, binds) = where_clause(&[filter("name", FilterOp::Contains, Some("50%_off\\"))], &[types()]).unwrap();
    assert_eq!(sql, " WHERE \"t0\".\"name\"::text ILIKE '%' || $1 || '%'");
    assert_eq!(binds, vec!["50\\%\\_off\\\\"]);
}

#[test]
fn starts_with_matches_the_start_of_the_text_form() {
    let (sql, binds) = where_clause(&[filter("name", FilterOp::StartsWith, Some("5_"))], &[types()]).unwrap();
    assert_eq!(sql, " WHERE \"t0\".\"name\"::text ILIKE $1 || '%'");
    assert_eq!(binds, vec!["5\\_"]);
}

#[test]
fn any_of_binds_the_listed_values_as_an_array_of_the_column_type() {
    let (sql, binds) = where_clause(&[filter("qty", FilterOp::In, Some(" 5, 7,, \"x\" "))], &[types()]).unwrap();
    assert_eq!(sql, " WHERE \"t0\".\"qty\" = ANY($1::integer[])");
    assert_eq!(binds, vec![r#"{"5","7","\"x\""}"#]);
    let empty = where_clause(&[filter("qty", FilterOp::In, Some(" , "))], &[types()]);
    assert!(matches!(empty, Err(AppError::Validation(_))));
}

#[test]
fn null_checks_take_no_value_and_filters_combine_with_and() {
    let (sql, binds) = where_clause(
        &[filter("at", FilterOp::IsNull, None), filter("qty", FilterOp::Ne, Some("0")), filter("name", FilterOp::NotNull, None)],
        &[types()],
    )
    .unwrap();
    assert_eq!(sql, " WHERE \"t0\".\"at\" IS NULL AND \"t0\".\"qty\" <> $1::integer AND \"t0\".\"name\" IS NOT NULL");
    assert_eq!(binds, vec!["0"]);
}

#[test]
fn a_filter_on_a_joined_table_uses_that_table_and_its_types() {
    let on_join = ColumnFilter { table: 1, ..filter("id", FilterOp::Gt, Some("7")) };
    let (sql, _) = where_clause(&[on_join], &[types(), joined_types()]).unwrap();
    assert_eq!(sql, " WHERE \"t1\".\"id\" > $1::bigint");
}

#[test]
fn an_unknown_column_or_table_or_a_missing_value_is_refused() {
    for filters in [
        vec![filter("nope", FilterOp::Eq, Some("1"))],
        vec![ColumnFilter { table: 2, ..filter("qty", FilterOp::Eq, Some("1")) }],
        vec![filter("qty", FilterOp::Lt, None)],
    ] {
        assert!(matches!(where_clause(&filters, &[types(), joined_types()]), Err(AppError::Validation(_))));
    }
}

#[test]
fn from_names_the_main_table_t0_and_each_join_after_it() {
    assert_eq!(from_clause("public", "merchants", &[]).unwrap(), "\"public\".\"merchants\" AS \"t0\"");
    let joins = [
        join("regions", JoinKind::Left, "id", (0, "region_id")),
        join("countries", JoinKind::Inner, "code", (1, "country")),
    ];
    assert_eq!(
        from_clause("public", "merchants", &joins).unwrap(),
        "\"public\".\"merchants\" AS \"t0\" \
         LEFT JOIN \"public\".\"regions\" AS \"t1\" ON \"t1\".\"id\" = \"t0\".\"region_id\" \
         JOIN \"public\".\"countries\" AS \"t2\" ON \"t2\".\"code\" = \"t1\".\"country\""
    );
}

#[test]
fn a_join_on_several_columns_needs_them_all_to_match() {
    let mut pairs = join("pairs", JoinKind::Inner, "a", (0, "a"));
    pairs.on.push(JoinOn { column: String::from("b"), equals: ColumnRef { table: 0, column: String::from("b") } });
    assert_eq!(
        from_clause("public", "refs", &[pairs]).unwrap(),
        "\"public\".\"refs\" AS \"t0\" JOIN \"public\".\"pairs\" AS \"t1\" ON \"t1\".\"a\" = \"t0\".\"a\" AND \"t1\".\"b\" = \"t0\".\"b\""
    );
    let mut none = join("pairs", JoinKind::Inner, "a", (0, "a"));
    none.on.clear();
    assert!(matches!(from_clause("public", "refs", &[none]), Err(AppError::Validation(_))));
}

#[test]
fn a_join_can_only_match_a_table_before_it() {
    let joins = [join("regions", JoinKind::Left, "id", (1, "id"))];
    assert!(matches!(from_clause("public", "merchants", &joins), Err(AppError::Validation(_))));
}
