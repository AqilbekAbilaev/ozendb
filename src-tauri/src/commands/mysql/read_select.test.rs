use super::MySqlTableDialect;
use crate::commands::sql::read_select::{read_table_select, TableSelect};
use crate::commands::sql::{ColumnFilter, ColumnRef, FilterOp};

fn read(sql: &str) -> Result<TableSelect, String> {
    read_table_select(&MySqlTableDialect, sql, "shop `db`", "orders ü")
}

fn f(table: usize, column: &str, op: FilterOp, value: Option<&str>) -> ColumnFilter {
    ColumnFilter { table, column: column.to_string(), op, value: value.map(str::to_string) }
}

fn c(table: usize, column: &str) -> ColumnRef {
    ColumnRef { table, column: column.to_string() }
}

#[test]
fn reads_back_the_sql_the_builder_writes() {
    // As buildSelectSql writes it with MySQL's dialect (engines/mysql/sql.js).
    let sql = "SELECT `orders ü`.`id`, `склад`.`label`\nFROM `shop ``db```.`orders ü`\nJOIN `shop ``db```.`buyers, b` ON `buyers, b`.`id` = `orders ü`.`buyer id`\nLEFT JOIN `elsewhere`.`склад` ON `склад`.`slot` = `orders ü`.`at slot` AND `склад`.`zone` = `buyers, b`.`Zone`\nWHERE `buyers, b`.`vip` = 1\n  AND `склад`.`big` IN (9007199254740993, 2)\n  AND CONVERT(`склад`.`label` USING utf8mb4) COLLATE utf8mb4_general_ci LIKE '%50\\\\%\\\\_off\\\\\\\\''%'\n  AND CONVERT(`orders ü`.`Name` USING utf8mb4) COLLATE utf8mb4_general_ci LIKE 'Ann%'\n  AND `orders ü`.`note` IS NULL\nORDER BY `buyers, b`.`name` DESC\nLIMIT 100 OFFSET 200;";
    let got = read(sql).unwrap();
    let described: Vec<String> = got
        .joins
        .iter()
        .map(|j| {
            let on: Vec<String> = j.on.iter().map(|p| format!("{}={}.{}", p.column, p.equals.table, p.equals.column)).collect();
            format!("{}.{} {:?} {}", j.schema, j.table, j.kind, on.join("&"))
        })
        .collect();
    assert_eq!(described, ["shop `db`.buyers, b Inner id=0.buyer id", "elsewhere.склад Left slot=0.at slot&zone=1.Zone"]);
    assert_eq!(got.columns, [c(0, "id"), c(2, "label")]);
    assert_eq!(
        got.filters,
        [
            f(1, "vip", FilterOp::Eq, Some("1")),
            f(2, "big", FilterOp::In, Some("9007199254740993, 2")),
            f(2, "label", FilterOp::Contains, Some("50%_off\\'")),
            f(0, "Name", FilterOp::StartsWith, Some("Ann")),
            f(0, "note", FilterOp::IsNull, None),
        ]
    );
    assert_eq!(got.order_by, [c(1, "name")]);
    assert!(got.descending);
    assert_eq!((got.limit, got.offset), (Some(100), 200));
}

#[test]
fn keeps_a_hand_written_name_as_written_and_reads_a_double_quoted_value() {
    let got = read("select * from `orders ü` where Qty > 5 and Note = \"it's\" order by Qty limit 5").unwrap();
    assert_eq!(got.filters, [f(0, "Qty", FilterOp::Gt, Some("5")), f(0, "Note", FilterOp::Eq, Some("it's"))]);
    assert_eq!(got.order_by, [c(0, "Qty")]);
}

#[test]
fn refuses_a_match_that_does_not_ignore_case_as_the_filter_does() {
    for sql in [
        "SELECT * FROM `orders ü` WHERE name LIKE '%a%'",
        "SELECT * FROM `orders ü` WHERE CONVERT(name USING utf8mb4) COLLATE utf8mb4_bin LIKE '%a%'",
        "SELECT * FROM `orders ü` WHERE CONVERT(name USING latin1) COLLATE utf8mb4_general_ci LIKE '%a%'",
        "SELECT * FROM `orders ü` WHERE name ILIKE '%a%'",
    ] {
        assert!(read(sql).is_err(), "should refuse: {sql}");
    }
}
