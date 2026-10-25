use super::{decimal, from_clause, in_utc, order_clause, requested, where_clause};
use crate::commands::mysql::MySqlColumnInfo;
use crate::commands::sql::{ColumnFilter, ColumnRef, FilterOp, JoinKind, JoinOn, TableJoin};
use crate::error::AppError;

fn columns() -> Vec<MySqlColumnInfo> {
    [("id `key`", "bigint unsigned", true), ("price €", "decimal(10,2)", false), ("name", "varchar(80)", false), ("at", "datetime(6)", false), ("ratio", "double", false), ("ok", "tinyint(1) unsigned", false), ("bits", "bit(64)", false), ("stamp", "timestamp(3)", false)]
        .into_iter()
        .map(|(name, data_type, is_primary_key)| MySqlColumnInfo {
            name: name.to_string(),
            data_type: data_type.to_string(),
            nullable: true,
            is_primary_key,
            default: None,
            generated: false,
            auto_increment: false,
            enum_values: None,
            references: None,
        })
        .collect()
}

fn filter(column: &str, op: FilterOp, value: Option<&str>) -> ColumnFilter {
    ColumnFilter { table: 0, column: column.to_string(), op, value: value.map(str::to_string) }
}

fn clause(filters: &[ColumnFilter]) -> (String, Vec<String>) {
    where_clause(filters, &[columns()]).unwrap()
}

#[test]
fn no_filters_add_no_where_clause() {
    assert_eq!(clause(&[]), (String::new(), vec![]));
}

#[test]
fn compares_exact_numbers_as_the_smallest_decimal_that_holds_the_value() {
    let (sql, binds) = clause(&[
        filter("id `key`", FilterOp::Gte, Some("18446744073709551615")),
        filter("price €", FilterOp::Lt, Some("1.505")),
        filter("bits", FilterOp::Eq, Some("5")),
    ]);
    assert_eq!(
        sql,
        " WHERE `t0`.`id ``key``` >= CAST(? AS DECIMAL(20,0)) AND `t0`.`price €` < CAST(? AS DECIMAL(4,3)) AND `t0`.`bits` = CAST(? AS DECIMAL(1,0))"
    );
    assert_eq!(binds, vec!["18446744073709551615", "1.505", "5"]);
}

#[test]
fn counts_a_number_s_digits_however_it_is_written() {
    assert_eq!(decimal("1e3"), Some((4, 0)));
    assert_eq!(decimal("-1.50e-3"), Some((4, 4)));
    assert_eq!(decimal("1.5E+1"), Some((2, 0)));
    assert_eq!(decimal("+007.250"), Some((3, 2)));
    assert_eq!(decimal(".5"), Some((1, 1)));
    assert_eq!(decimal("5."), Some((1, 0)));
    assert_eq!(decimal("-0.000e9"), Some((1, 0)));
    assert_eq!(decimal("1e-40"), Some((40, 40)));
}

#[test]
fn reads_nothing_but_a_number_as_one() {
    for text in ["", ".", "-", "1e", "e5", "1.2.3", "--1", "0x10", "1 000", "abc"] {
        assert_eq!(decimal(text), None, "{text:?}");
    }
}

#[test]
fn compares_values_at_mysql_s_decimal_limits_exactly() {
    let (widest, finest) = ("1e64", format!("{}.{}", "9".repeat(35), "9".repeat(30)));
    let (sql, _) = clause(&[filter("id `key`", FilterOp::Gt, Some(widest)), filter("price €", FilterOp::Eq, Some(&finest))]);
    assert_eq!(sql, " WHERE `t0`.`id ``key``` > CAST(? AS DECIMAL(65,0)) AND `t0`.`price €` = CAST(? AS DECIMAL(65,30))");
}

#[test]
fn refuses_a_number_past_mysql_s_decimal_limits_rather_than_rounding_it() {
    let refused = |value: &str| matches!(where_clause(&[filter("price €", FilterOp::Eq, Some(value))], &[columns()]), Err(AppError::Validation(_)));
    assert!(refused("1e-40"));
    assert!(refused(&format!("0.{}1", "0".repeat(30))));
    assert!(refused("1e65"));
    assert!(refused(&format!("1{}.5", "0".repeat(64))));
    assert!(!refused(&format!("0.{}1", "0".repeat(29))));
}

#[test]
fn reads_true_and_false_on_a_tinyint_1_as_the_1_and_0_it_stores() {
    let (sql, binds) = clause(&[filter("ok", FilterOp::Eq, Some("TRUE")), filter("ok", FilterOp::In, Some("false, 5"))]);
    assert_eq!(sql, " WHERE `t0`.`ok` = CAST(? AS DECIMAL(1,0)) AND `t0`.`ok` IN (CAST(? AS DECIMAL(1,0)), CAST(? AS DECIMAL(1,0)))");
    assert_eq!(binds, vec!["1", "0", "5"]);
}

#[test]
fn refuses_a_value_that_is_not_a_number_on_a_number_column() {
    let refused = |column: &str, op: FilterOp, value: &str| match where_clause(&[filter(column, op, Some(value))], &[columns()]) {
        Err(AppError::Validation(message)) => message,
        other => panic!("{column} {value:?} gave {other:?}"),
    };
    assert_eq!(refused("id `key`", FilterOp::Eq, "abc"), "The filter on \"id `key`\" needs a number.");
    assert_eq!(refused("price €", FilterOp::Gt, "1,5"), "The filter on \"price €\" needs a number.");
    assert_eq!(refused("bits", FilterOp::In, "1, 0x10"), "The filter on \"bits\" needs a number.");
    assert_eq!(refused("id `key`", FilterOp::Eq, "true"), "The filter on \"id `key`\" needs a number.");
    assert_eq!(refused("ok", FilterOp::Ne, "yes"), "The filter on \"ok\" needs a number, or true or false.");
}

#[test]
fn leaves_true_as_text_on_any_other_column() {
    let (_, binds) = clause(&[filter("name", FilterOp::Eq, Some("true"))]);
    assert_eq!(binds, vec!["true"]);
}

#[test]
fn compares_text_dates_and_floats_against_the_bound_value_as_it_is() {
    let (sql, binds) = clause(&[filter("name", FilterOp::Ne, Some("a'b")), filter("at", FilterOp::Gt, Some("2024-02-29")), filter("ratio", FilterOp::Eq, Some("0.5"))]);
    assert_eq!(sql, " WHERE `t0`.`name` <> ? AND `t0`.`at` > ? AND `t0`.`ratio` = ?");
    assert_eq!(binds, vec!["a'b", "2024-02-29", "0.5"]);
}

#[test]
fn reads_a_shown_timestamp_back_as_utc() {
    let tashkent = chrono::FixedOffset::east_opt(5 * 3600).unwrap();
    assert_eq!(in_utc("2024-07-01 03:59:59.120+05:00", &tashkent, Some(3)).as_deref(), Some("2024-06-30 22:59:59.120"));
    assert_eq!(in_utc("2024-06-30 18:59:59.120-04:00", &tashkent, Some(3)).as_deref(), Some("2024-06-30 22:59:59.120"));
    // Without an offset, a date and time is the user's own.
    assert_eq!(in_utc(" 2024-07-01 03:59:59 ", &tashkent, Some(0)).as_deref(), Some("2024-06-30 22:59:59"));
    assert_eq!(in_utc("2024-07-01", &tashkent, Some(0)), None);
    assert_eq!(in_utc("59.120+05:00", &tashkent, Some(3)), None);
}

#[test]
fn sends_part_of_a_timestamp_as_it_is() {
    let (_, binds) = clause(&[filter("stamp", FilterOp::Contains, Some("59.120")), filter("stamp", FilterOp::StartsWith, Some("2024-06"))]);
    assert_eq!(binds, vec!["59.120", "2024-06"]);
}

#[test]
fn keeps_a_zone_on_any_other_column() {
    let (_, binds) = clause(&[filter("at", FilterOp::Eq, Some("2024-01-01 00:00:00+00:00")), filter("name", FilterOp::Contains, Some("+00:00"))]);
    assert_eq!(binds, vec!["2024-01-01 00:00:00+00:00", "+00:00"]);
}

#[test]
fn contains_matches_the_text_form_ignoring_case_with_wildcards_escaped() {
    let (sql, binds) = clause(&[filter("name", FilterOp::Contains, Some("50%_off\\"))]);
    assert_eq!(sql, " WHERE CONVERT(`t0`.`name` USING utf8mb4) COLLATE utf8mb4_general_ci LIKE CONCAT('%', ?, '%')");
    assert_eq!(binds, vec!["50\\%\\_off\\\\"]);
}

#[test]
fn starts_with_matches_the_start_of_the_text_form() {
    let (sql, binds) = clause(&[filter("id `key`", FilterOp::StartsWith, Some("12"))]);
    assert_eq!(sql, " WHERE CONVERT(`t0`.`id ``key``` USING utf8mb4) COLLATE utf8mb4_general_ci LIKE CONCAT(?, '%')");
    assert_eq!(binds, vec!["12"]);
}

#[test]
fn any_of_binds_each_trimmed_value() {
    let (sql, binds) = clause(&[filter("id `key`", FilterOp::In, Some(" 1, 2 ,,3")), filter("name", FilterOp::In, Some("a,b"))]);
    assert_eq!(sql, " WHERE `t0`.`id ``key``` IN (CAST(? AS DECIMAL(1,0)), CAST(? AS DECIMAL(1,0)), CAST(? AS DECIMAL(1,0))) AND `t0`.`name` IN (?, ?)");
    assert_eq!(binds, vec!["1", "2", "3", "a", "b"]);
}

#[test]
fn null_checks_bind_nothing() {
    let (sql, binds) = clause(&[filter("name", FilterOp::IsNull, None), filter("at", FilterOp::NotNull, None)]);
    assert_eq!(sql, " WHERE `t0`.`name` IS NULL AND `t0`.`at` IS NOT NULL");
    assert!(binds.is_empty());
}

#[test]
fn refuses_an_unknown_column_a_missing_value_an_empty_list_and_a_table_not_in_the_browse() {
    let refused = |f: ColumnFilter| matches!(where_clause(&[f], &[columns()]), Err(AppError::Validation(_)));
    assert!(refused(filter("nope", FilterOp::Eq, Some("1"))));
    assert!(refused(filter("name", FilterOp::Eq, None)));
    assert!(refused(filter("name", FilterOp::In, Some(" , "))));
    assert!(refused(ColumnFilter { table: 1, ..filter("name", FilterOp::IsNull, None) }));
}

#[test]
fn orders_by_the_chosen_column_then_the_primary_key_or_else_the_key_alone() {
    assert_eq!(order_clause(Some(&ColumnRef { table: 0, column: "name".into() }), true, &[columns()]).unwrap(), " ORDER BY `t0`.`name` DESC, `t0`.`id ``key``` DESC");
    assert_eq!(order_clause(None, false, &[columns()]).unwrap(), " ORDER BY `t0`.`id ``key``` ASC");
    assert_eq!(order_clause(Some(&ColumnRef { table: 0, column: String::new() }), false, &[columns()]).unwrap(), " ORDER BY `t0`.`id ``key``` ASC");
}

#[test]
fn leaves_a_table_without_a_primary_key_unordered() {
    let keyless: Vec<_> = columns().into_iter().filter(|c| !c.is_primary_key).collect();
    assert_eq!(order_clause(None, false, &[keyless]).unwrap(), "");
}

#[test]
fn refuses_to_order_by_a_column_the_table_lacks() {
    assert!(matches!(order_clause(Some(&ColumnRef { table: 0, column: "nope".into() }), false, &[columns()]), Err(AppError::Validation(_))));
}

/// A table joined in, whose columns are typed differently from the browsed table's.
fn joined() -> Vec<MySqlColumnInfo> {
    let mut columns = columns();
    columns[2].data_type = String::from("int");
    columns
}

fn join(database: &str, table: &str, kind: JoinKind, on: &[(&str, usize, &str)]) -> TableJoin {
    let on = on.iter().map(|&(column, table, equals)| JoinOn { column: column.into(), equals: ColumnRef { table, column: equals.into() } }).collect();
    TableJoin { schema: database.into(), table: table.into(), kind, on }
}

#[test]
fn names_the_browsed_table_and_each_join_by_its_place() {
    let joins = [
        join("other `db`", "склад", JoinKind::Inner, &[("slot", 0, "id `key`"), ("zone", 0, "name")]),
        join("shop", "shop", JoinKind::Left, &[("id", 1, "slot")]),
    ];
    assert_eq!(
        from_clause("shop", "shop", &joins).unwrap(),
        "`shop`.`shop` AS `t0` JOIN `other ``db```.`склад` AS `t1` ON `t1`.`slot` = `t0`.`id ``key``` AND `t1`.`zone` = `t0`.`name` \
         LEFT JOIN `shop`.`shop` AS `t2` ON `t2`.`id` = `t1`.`slot`"
    );
}

#[test]
fn refuses_a_join_on_nothing_or_on_a_table_after_it() {
    let refused = |joins: &[TableJoin]| matches!(from_clause("shop", "t", joins), Err(AppError::Validation(_)));
    assert!(refused(&[join("shop", "u", JoinKind::Left, &[])]));
    assert!(refused(&[join("shop", "u", JoinKind::Left, &[("id", 1, "id")])]));
}

#[test]
fn compares_a_joined_column_by_its_own_table_s_type() {
    let on_join = ColumnFilter { table: 1, ..filter("name", FilterOp::Eq, Some("7")) };
    let (sql, binds) = where_clause(&[filter("name", FilterOp::Eq, Some("7")), on_join], &[columns(), joined()]).unwrap();
    assert_eq!(sql, " WHERE `t0`.`name` = ? AND `t1`.`name` = CAST(? AS DECIMAL(1,0))");
    assert_eq!(binds, vec!["7", "7"]);
}

#[test]
fn orders_by_a_joined_column_or_refuses_one_its_table_lacks() {
    let tables = [columns(), joined()];
    assert_eq!(order_clause(Some(&ColumnRef { table: 1, column: "at".into() }), false, &tables).unwrap(), " ORDER BY `t1`.`at` ASC, `t0`.`id ``key``` ASC, `t1`.`id ``key``` ASC");
    assert!(order_clause(Some(&ColumnRef { table: 2, column: "at".into() }), false, &tables).is_err());
    assert!(order_clause(Some(&ColumnRef { table: 1, column: "nope".into() }), false, &tables).is_err());
}

#[test]
fn orders_a_join_by_every_table_s_primary_key_in_turn_so_pages_neither_overlap_nor_skip() {
    let keyless: Vec<_> = columns().into_iter().filter(|c| !c.is_primary_key).collect();
    let tables = [columns(), keyless, joined()];
    assert_eq!(order_clause(None, true, &tables).unwrap(), " ORDER BY `t0`.`id ``key``` DESC, `t2`.`id ``key``` DESC");
}

#[test]
fn asks_once_for_each_table_wanted_and_for_no_table_the_browse_lacks() {
    let joins = [join("other `db`", "склад", JoinKind::Inner, &[("slot", 0, "id")]), join("shop", "shop ü", JoinKind::Left, &[("id", 1, "slot")])];
    assert_eq!(requested("shop", "shop ü", &joins, &[2, 0, 2, 9]), [(0, ("shop", "shop ü")), (2, ("shop", "shop ü"))]);
    assert_eq!(requested("shop", "shop ü", &joins, &[]), []);
}
