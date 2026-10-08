use super::{read_table_select, TableSelect};
use crate::commands::postgres::browse::{ColumnFilter, ColumnRef, FilterOp, JoinKind};

fn read(sql: &str) -> Result<TableSelect, String> {
    read_table_select(sql, "public", "users")
}

fn f(column: &str, op: FilterOp, value: Option<&str>) -> ColumnFilter {
    ColumnFilter { table: 0, column: column.to_string(), op, value: value.map(str::to_string) }
}

fn c(table: usize, column: &str) -> ColumnRef {
    ColumnRef { table, column: column.to_string() }
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
    assert_eq!(got.order_by, vec![c(0, "name")]);
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
    assert_eq!(got.order_by, vec![c(0, "age")]);
    assert!(!got.descending);
    assert_eq!((got.limit, got.offset), (None, 0));
    assert!(read("SELECT * FROM users WHERE (name ILIKE '%ad%')").is_ok());
}

#[test]
fn reads_back_starts_with_and_any_of() {
    let got = read("SELECT * FROM users WHERE \"code\"::text ILIKE '5\\_%' AND \"mcc\" IN ('5411', '5812') AND n IN (1, -2)").unwrap();
    assert_eq!(
        got.filters,
        vec![
            f("code", FilterOp::StartsWith, Some("5_")),
            f("mcc", FilterOp::In, Some("5411, 5812")),
            f("n", FilterOp::In, Some("1, -2")),
        ]
    );
    // A listed value holding a comma would read back as two.
    assert!(read("SELECT * FROM users WHERE a IN ('x,y')").is_err());
    assert!(read("SELECT * FROM users WHERE a NOT IN ('x')").is_err());
    assert!(read("SELECT * FROM users WHERE a ILIKE '%'").is_err());
}

#[test]
fn reads_a_plain_column_list_as_the_columns_to_show() {
    let got = read("SELECT \"id\", Name FROM users").unwrap();
    assert_eq!(got.columns, vec![c(0, "id"), c(0, "name")]);
    // A table's own name or alias may qualify its columns.
    assert_eq!(read("SELECT u.id FROM public.users AS u").unwrap().columns, vec![c(0, "id")]);
    assert_eq!(read("SELECT users.id FROM users").unwrap().columns, vec![c(0, "id")]);
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
        "SELECT * FROM users JOIN orders ON true",
        "SELECT * FROM users JOIN orders ON users.id = orders.user_id OR users.id = 1",
        "SELECT * FROM users RIGHT JOIN orders ON users.id = orders.user_id",
        "SELECT * FROM users JOIN orders USING (id)",
        "SELECT users.* FROM users JOIN orders ON users.id = orders.user_id",
        "SELECT id FROM users JOIN orders ON users.id = orders.user_id",
        "SELECT * FROM users JOIN orders ON users.id = orders.user_id WHERE id = 1",
        "SELECT * FROM users JOIN orders ON orders.id = orders.user_id",
        "SELECT * FROM users JOIN orders ON users.id = nope.user_id",
        "SELECT * FROM users u WHERE users.id = 1",
        "SELECT * FROM users WHERE a = 1 OR b = 2",
        "SELECT * FROM users WHERE a ILIKE '%x%y%'",
        "SELECT * FROM users WHERE a LIKE '%x%'",
        "SELECT * FROM users WHERE lower(a) = 'x'",
        "SELECT * FROM users WHERE a = b",
        "SELECT * FROM users ORDER BY a ASC, b DESC",
        "SELECT * FROM users ORDER BY a USING >",
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

#[test]
fn reads_back_the_joins_the_builder_writes() {
    let sql = "SELECT \"users\".*, \"regions\".*, \"countries\".*\nFROM \"public\".\"users\"\nLEFT JOIN \"public\".\"regions\" ON \"regions\".\"id\" = \"users\".\"region_id\"\nJOIN \"geo\".\"countries\" ON \"countries\".\"code\" = \"regions\".\"country\" AND \"countries\".\"zone\" = \"users\".\"zone\"\nWHERE \"regions\".\"name\"::text ILIKE '%so%'\nORDER BY \"regions\".\"name\" DESC\nLIMIT 100;";
    let got = read(sql).unwrap();
    let described: Vec<String> = got
        .joins
        .iter()
        .map(|j| {
            let on: Vec<String> = j.on.iter().map(|p| format!("{}={}.{}", p.column, p.equals.table, p.equals.column)).collect();
            format!("{}.{} {:?} {}", j.schema, j.table, j.kind, on.join("&"))
        })
        .collect();
    assert_eq!(described, vec!["public.regions Left id=0.region_id", "geo.countries Inner code=1.country&zone=0.zone"]);
    assert!(got.columns.is_empty(), "every table's * is every column");
    assert_eq!(got.filters, vec![ColumnFilter { table: 1, ..f("name", FilterOp::Contains, Some("so")) }]);
    assert_eq!(got.order_by, vec![c(1, "name")]);
}

#[test]
fn reads_hand_written_joins_with_aliases_either_way_round() {
    let got = read("select m.name, r.name from users m inner join regions as r on m.region_id = r.id where r.id > 2 limit 5").unwrap();
    assert_eq!(got.joins.len(), 1);
    assert_eq!(got.joins[0].kind, JoinKind::Inner);
    assert_eq!((got.joins[0].on[0].column.as_str(), &got.joins[0].on[0].equals), ("id", &c(0, "region_id")));
    assert_eq!(got.columns, vec![c(0, "name"), c(1, "name")]);
    assert_eq!(got.filters, vec![ColumnFilter { table: 1, ..f("id", FilterOp::Gt, Some("2")) }]);
    // A table joined to itself is told apart by its alias.
    let own = read("SELECT * FROM users JOIN users AS users_2 ON users_2.id = users.parent_id LIMIT 5").unwrap();
    assert_eq!((own.joins[0].table.as_str(), &own.joins[0].on[0].equals), ("users", &c(0, "parent_id")));
}
