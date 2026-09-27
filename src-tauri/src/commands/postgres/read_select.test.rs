use super::{read_table_select, TableSelect};
use crate::commands::postgres::browse::{ColumnFilter, FilterOp};

fn read(sql: &str) -> Result<TableSelect, String> {
    read_table_select(sql, "public", "users")
}

fn f(column: &str, op: FilterOp, value: Option<&str>) -> ColumnFilter {
    ColumnFilter { table: 0, column: column.to_string(), op, value: value.map(str::to_string) }
}

#[test]
fn reads_back_the_sql_the_filters_build() {
    let sql = "SELECT *\nFROM \"public\".\"users\"\nWHERE \"age\" >= '30'\n  AND \"name\"::text ILIKE '%50\\%\\_off\\\\%'\n  AND \"email\" IS NULL\n  AND \"ok\" IS NOT NULL\n  AND \"role\" <> 'O''Brien'\nORDER BY \"name\" DESC\nLIMIT 100 OFFSET 200;";
    let got = read(sql).unwrap();
    assert_eq!(
        got.filters,
        vec![
            f("age", FilterOp::Gte, Some("30")),
            f("name", FilterOp::Contains, Some("50%_off\\")),
            f("email", FilterOp::IsNull, None),
            f("ok", FilterOp::NotNull, None),
            f("role", FilterOp::Ne, Some("O'Brien")),
        ]
    );
    assert_eq!(got.order_by, vec!["name"]);
    assert!(got.descending);
    assert_eq!(got.limit, Some(100));
    assert_eq!(got.offset, 200);
}

#[test]
fn reads_hand_written_sql_the_way_postgres_would() {
    // Unquoted names fold to lower case; numbers and booleans need no quotes.
    let got = read("select * from Users where Age > 5 and active = true and n < -3 and x != 1 order by Age").unwrap();
    assert_eq!(
        got.filters,
        vec![
            f("age", FilterOp::Gt, Some("5")),
            f("active", FilterOp::Eq, Some("true")),
            f("n", FilterOp::Lt, Some("-3")),
            f("x", FilterOp::Ne, Some("1")),
        ]
    );
    assert_eq!(got.order_by, vec!["age"]);
    assert!(!got.descending);
    assert_eq!((got.limit, got.offset), (None, 0));
    assert!(read("SELECT * FROM users WHERE (name ILIKE '%ad%')").is_ok());
}

#[test]
fn reads_a_plain_column_list_as_the_columns_to_show() {
    let got = read("SELECT \"id\", Name FROM users").unwrap();
    assert_eq!(got.columns, vec!["id", "name"]);
    assert!(read("SELECT * FROM users").unwrap().columns.is_empty());
}

#[test]
fn refuses_what_the_filter_boxes_cannot_show() {
    for sql in [
        "SELECT * FROM public.orders",
        "SELECT * FROM other.users",
        "SELECT id, * FROM users",
        "SELECT id AS key FROM users",
        "SELECT lower(name) FROM users",
        "SELECT * FROM users u",
        "SELECT * FROM users JOIN orders ON true",
        "SELECT * FROM users WHERE a = 1 OR b = 2",
        "SELECT * FROM users WHERE a ILIKE '%x%y%'",
        "SELECT * FROM users WHERE a LIKE '%x%'",
        "SELECT * FROM users WHERE lower(a) = 'x'",
        "SELECT * FROM users WHERE a = b",
        "SELECT * FROM users ORDER BY a ASC, b DESC",
        "SELECT DISTINCT * FROM users",
        "SELECT * FROM users GROUP BY a",
        "WITH x AS (SELECT 1) SELECT * FROM users",
        "SELECT * FROM users; SELECT * FROM users",
        "DELETE FROM users",
        "not sql at all",
    ] {
        assert!(read(sql).is_err(), "should refuse: {sql}");
    }
}
