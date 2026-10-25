use super::{edited_key, entry};
use crate::commands::mysql::{MySqlColumnInfo, MySqlRowUpdate};
use crate::commands::postgres::ColumnValue;
use serde_json::{json, Value};

fn info(name: &str, is_primary_key: bool) -> MySqlColumnInfo {
    MySqlColumnInfo {
        name: name.to_string(),
        data_type: String::from("varbinary(4)"),
        nullable: !is_primary_key,
        is_primary_key,
        default: None,
        generated: false,
        auto_increment: false,
        enum_values: None,
        references: None,
    }
}

fn columns() -> Vec<MySqlColumnInfo> {
    vec![info("id `key`", true), info("note ü", false), info("region.x", true)]
}

fn value(column: &str, value: Value) -> ColumnValue {
    ColumnValue { column: column.to_string(), value }
}

fn pairs(values: &[ColumnValue]) -> Value {
    json!(values.iter().map(|item| json!([item.column, item.value])).collect::<Vec<_>>())
}

#[test]
fn an_edit_of_a_key_column_finds_the_row_by_its_new_key() {
    let change = MySqlRowUpdate {
        set: vec![value("note ü", json!("x")), value("region.x", json!("0x02"))],
        before: vec![],
        r#where: vec![value("region.x", json!("0x01")), value("id `key`", json!(1))],
    };
    assert_eq!(pairs(&edited_key(&columns(), &change)), json!([["id `key`", 1], ["region.x", "0x02"]]));
}

#[test]
fn an_edit_of_other_columns_finds_the_row_by_the_key_it_was_loaded_by() {
    let change = MySqlRowUpdate {
        set: vec![value("note ü", json!(null))],
        before: vec![],
        r#where: vec![value("id `key`", json!("18446744073709551615")), value("region.x", json!("0x01"))],
    };
    assert_eq!(pairs(&edited_key(&columns(), &change)), json!([["id `key`", "18446744073709551615"], ["region.x", "0x01"]]));
}

#[test]
fn an_entry_pairs_each_set_column_with_its_value_before_and_what_the_row_now_holds() {
    let change = MySqlRowUpdate {
        set: vec![value("note ü", json!("1.10")), value("region.x", json!("0x02"))],
        before: vec![value("region.x", json!("0x01")), value("note ü", json!({ "a": [1] }))],
        r#where: vec![],
    };
    let key = vec![value("id `key`", json!(1)), value("region.x", json!("0x02"))];
    let made = entry("conn ü", "shop.db", "order `items`", &change, key, vec![json!(1.1), json!("0x02")]);
    assert_eq!(
        (made.conn_id.as_str(), made.database.as_str(), made.schema.as_str(), made.table.as_str()),
        ("conn ü", "shop.db", "", "order `items`")
    );
    assert_eq!(pairs(&made.key), json!([["id `key`", 1], ["region.x", "0x02"]]));
    let changes: Vec<Value> = made.changes.iter().map(|c| json!([c.column, c.before, c.after])).collect();
    assert_eq!(changes, [json!(["note ü", { "a": [1] }, 1.1]), json!(["region.x", "0x01", "0x02"])]);
}

#[test]
fn an_entry_without_a_value_before_records_null() {
    let change = MySqlRowUpdate { set: vec![value("note ü", json!("x"))], before: vec![], r#where: vec![] };
    let made = entry("c", "d", "t", &change, vec![], vec![json!("x")]);
    assert_eq!(made.changes[0].before, Value::Null);
}
