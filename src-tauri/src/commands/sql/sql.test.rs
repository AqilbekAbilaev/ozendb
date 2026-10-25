use super::order_clause;

fn names(names: &[&str]) -> Vec<String> {
    names.iter().map(|n| n.to_string()).collect()
}

#[test]
fn breaks_ties_in_the_chosen_column_with_each_key_in_the_same_direction() {
    let keys = names(&["\"t0\".\"id ü\"", "\"t1\".\"id\""]);
    assert_eq!(
        order_clause(Some(String::from("\"t1\".\"due date\"")), keys, true),
        " ORDER BY \"t1\".\"due date\" DESC, \"t0\".\"id ü\" DESC, \"t1\".\"id\" DESC"
    );
}

#[test]
fn names_a_key_chosen_as_the_sort_only_once() {
    let keys = names(&["\"t0\".\"a\"", "\"t0\".\"b\""]);
    assert_eq!(order_clause(Some(String::from("\"t0\".\"b\"")), keys, false), " ORDER BY \"t0\".\"b\" ASC, \"t0\".\"a\" ASC");
}

#[test]
fn orders_by_the_keys_alone_without_a_chosen_column() {
    assert_eq!(order_clause(None, names(&["`t0`.`id`"]), false), " ORDER BY `t0`.`id` ASC");
}

#[test]
fn leaves_a_keyless_table_without_a_chosen_column_unordered() {
    assert_eq!(order_clause(None, Vec::new(), true), "");
}
