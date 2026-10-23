use super::{delete, insert, matched, stored, update, MySqlRowUpdate, Param};
use crate::commands::mysql::MySqlColumnInfo;
use crate::commands::postgres::ColumnValue;
use crate::error::AppError;
use serde_json::{json, Value};

const TABLE: &str = "`shop ü`.`order ``items```";
const PLACE: &str = "table \"order `items`\" of database \"shop ü\"";

fn info(name: &str, data_type: &str, is_primary_key: bool, generated: bool) -> MySqlColumnInfo {
    MySqlColumnInfo {
        name: name.to_string(),
        data_type: data_type.to_string(),
        nullable: !is_primary_key,
        is_primary_key,
        default: None,
        generated,
        auto_increment: false,
        enum_values: None,
        references: None,
    }
}

fn columns() -> Vec<MySqlColumnInfo> {
    vec![
        info("id `key`", "bigint unsigned", true, false),
        info("region", "varbinary(4)", true, false),
        info("note ü", "text", false, false),
        info("area", "int", false, true),
    ]
}

fn value(column: &str, value: Value) -> ColumnValue {
    ColumnValue { column: column.to_string(), value }
}

fn key(id: Value, region: &str) -> Vec<ColumnValue> {
    vec![value("id `key`", id), value("region", json!(region))]
}

fn text(value: &str) -> Param {
    Param::Text(value.to_string())
}

fn message(result: Result<impl std::fmt::Debug, AppError>) -> String {
    match result {
        Err(AppError::Validation(message)) => message,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn stores_numbers_dates_and_text_as_the_text_mysql_reads_them_from() {
    let stored = |data_type: &str, value: Value| stored(&info("c", data_type, false, false), &value).unwrap();
    assert_eq!(stored("bigint unsigned", json!("18446744073709551615")), text("18446744073709551615"));
    assert_eq!(stored("decimal(30,10)", json!("12345678901234567890.0123456789")), text("12345678901234567890.0123456789"));
    assert_eq!(stored("double", json!(-1.5e300)), text("-1.5e+300"));
    assert_eq!(stored("datetime(6)", json!("2024-02-29 13:14:15.123456")), text("2024-02-29 13:14:15.123456"));
    assert_eq!(stored("set('a','b')", json!("a,b")), text("a,b"));
    assert_eq!(stored("varchar(20)", json!("Straße")), text("Straße"));
}

#[test]
fn stores_a_timestamp_without_the_zone_the_grid_shows() {
    let stamp = info("c", "timestamp(3)", false, false);
    let shown = format!("2024-06-30 18:59:59.120{}", crate::mysql::session::zone());
    assert_eq!(stored(&stamp, &json!(shown)).unwrap(), text("2024-06-30 18:59:59.120"));
}

#[test]
fn stores_true_and_false_as_1_and_0() {
    let flag = info("c", "tinyint(1)", false, false);
    assert_eq!(stored(&flag, &json!(true)).unwrap(), text("1"));
    assert_eq!(stored(&flag, &json!(" False ")).unwrap(), text("0"));
    assert_eq!(stored(&info("c", "int", false, false), &json!(false)).unwrap(), text("0"));
}

#[test]
fn stores_json_as_its_json_text() {
    let doc = info("c", "json", false, false);
    assert_eq!(stored(&doc, &json!({ "a": [1, "b"] })).unwrap(), text(r#"{"a":[1,"b"]}"#));
    assert_eq!(stored(&doc, &json!("hi")).unwrap(), text(r#""hi""#));
}

#[test]
fn stores_bits_as_the_number_they_make() {
    let bits = info("c", "bit(64)", false, false);
    assert_eq!(stored(&bits, &json!(5)).unwrap(), Param::Number(5));
    assert_eq!(stored(&bits, &json!("18446744073709551615")).unwrap(), Param::Number(u64::MAX));
    assert!(message(stored(&bits, &json!("b'101'"))).contains("whole number"));
}

#[test]
fn stores_binary_and_spatial_values_from_their_hex() {
    assert_eq!(stored(&info("c", "varbinary(4)", false, false), &json!("0x00fF")).unwrap(), Param::Bytes(vec![0, 255]));
    assert_eq!(stored(&info("c", "point", false, false), &json!("0x")).unwrap(), Param::Bytes(vec![]));
    for bad in ["00FF", "0x0", "0xZZ", "0xé1"] {
        assert!(message(stored(&info("c", "blob", false, false), &json!(bad))).contains("hex"), "{bad}");
    }
}

#[test]
fn stores_null_as_null_whatever_the_type() {
    for data_type in ["int", "json", "blob", "bit(1)"] {
        assert_eq!(stored(&info("c", data_type, false, false), &Value::Null).unwrap(), Param::Null);
    }
}

#[test]
fn matches_a_big_key_exactly_and_a_binary_key_by_its_bytes() {
    let (placeholder, param) = matched(&info("id", "bigint unsigned", true, false), &json!("18446744073709551615")).unwrap();
    assert_eq!((placeholder.as_str(), param), ("CAST(? AS DECIMAL(20,0))", text("18446744073709551615")));
    let (placeholder, param) = matched(&info("id", "binary(2)", true, false), &json!("0xABCD")).unwrap();
    assert_eq!((placeholder.as_str(), param), ("?", Param::Bytes(vec![0xAB, 0xCD])));
    let (placeholder, param) = matched(&info("at", "timestamp", true, false), &json!(format!("2024-01-01 00:00:00{}", crate::mysql::session::zone()))).unwrap();
    assert_eq!((placeholder.as_str(), param), ("?", text("2024-01-01 00:00:00")));
}

#[test]
fn inserts_the_values_given_and_a_row_of_defaults_when_none_are() {
    let (sql, params) = insert(TABLE, &columns(), &[value("note ü", json!("hi")), value("id `key`", json!(7))]).unwrap();
    assert_eq!(sql, "INSERT INTO `shop ü`.`order ``items``` (`note ü`, `id ``key```) VALUES (?, ?)");
    assert_eq!(params, [text("hi"), text("7")]);
    assert_eq!(insert(TABLE, &columns(), &[]).unwrap().0, "INSERT INTO `shop ü`.`order ``items``` () VALUES ()");
}

#[test]
fn updates_a_row_found_by_its_whole_primary_key() {
    let change = MySqlRowUpdate { set: vec![value("note ü", Value::Null)], r#where: key(json!(1), "0x01") };
    let (sql, params) = update(TABLE, PLACE, &columns(), &change).unwrap();
    assert_eq!(
        sql,
        "UPDATE `shop ü`.`order ``items``` SET `note ü` = ? WHERE `id ``key``` = CAST(? AS DECIMAL(1,0)) AND `region` = ?"
    );
    assert_eq!(params, [Param::Null, text("1"), Param::Bytes(vec![1])]);
}

#[test]
fn deletes_every_row_in_one_statement() {
    let [(sql, params)]: [_; 1] = delete(TABLE, &columns(), &[key(json!(1), "0x01"), key(json!(22), "0x")]).unwrap().try_into().unwrap();
    assert_eq!(
        sql,
        "DELETE FROM `shop ü`.`order ``items``` WHERE (`id ``key``` = CAST(? AS DECIMAL(1,0)) AND `region` = ?) \
         OR (`id ``key``` = CAST(? AS DECIMAL(2,0)) AND `region` = ?)"
    );
    assert_eq!(params, [text("1"), Param::Bytes(vec![1]), text("22"), Param::Bytes(vec![])]);
}

#[test]
fn refuses_a_row_named_by_less_than_its_primary_key() {
    let change = MySqlRowUpdate { set: vec![value("note ü", json!("x"))], r#where: vec![value("id `key`", json!(1))] };
    assert!(message(update(TABLE, PLACE, &columns(), &change)).contains("primary key"));
    assert!(message(delete(TABLE, &columns(), &[vec![value("region", json!("0x01"))]])).contains("primary key"));
}

#[test]
fn refuses_to_find_a_row_in_a_table_without_a_primary_key() {
    let keyless = vec![info("note", "text", false, false)];
    let change = MySqlRowUpdate { set: vec![value("note", json!("x"))], r#where: vec![value("note", json!("y"))] };
    assert!(message(update(TABLE, PLACE, &keyless, &change)).contains("no primary key"));
    assert!(message(delete(TABLE, &keyless, &[vec![value("note", json!("y"))]])).contains("no primary key"));
}

#[test]
fn refuses_a_value_for_a_generated_or_unknown_column() {
    assert!(message(insert(TABLE, &columns(), &[value("area", json!(4))])).contains("generated"));
    let change = MySqlRowUpdate { set: vec![value("missing", json!(4))], r#where: key(json!(1), "0x01") };
    assert!(message(update(TABLE, PLACE, &columns(), &change)).contains("Unknown column"));
    let nothing = MySqlRowUpdate { set: vec![], r#where: key(json!(1), "0x01") };
    assert_eq!(
        message(update(TABLE, PLACE, &columns(), &nothing)),
        "Nothing to update in table \"order `items`\" of database \"shop ü\"."
    );
}

#[test]
fn words_a_key_that_is_not_a_number_as_a_key_not_a_filter() {
    let refused = message(matched(&info("id `key`", "bigint unsigned", true, false), &json!("abc")));
    assert_eq!(refused, "The key value for \"id `key`\" needs a number.");
}

#[test]
fn deletes_in_statements_of_at_most_the_65535_values_mysql_binds() {
    let rows: Vec<Vec<ColumnValue>> = (0..32_768).map(|id| key(json!(id), "0x01")).collect();
    let statements = delete(TABLE, &columns(), &rows).unwrap();
    let sizes: Vec<usize> = statements.iter().map(|(_, params)| params.len()).collect();
    assert_eq!(sizes, [65_534, 2]);
    assert!(statements[1].0.ends_with("WHERE (`id ``key``` = CAST(? AS DECIMAL(5,0)) AND `region` = ?)"));
}
