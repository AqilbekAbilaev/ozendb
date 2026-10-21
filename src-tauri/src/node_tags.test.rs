use super::NodeTagStorage;
use tempfile::tempdir;

fn store() -> (tempfile::TempDir, NodeTagStorage) {
    let dir = tempdir().unwrap();
    let store = NodeTagStorage::new(dir.path().join("node_tags.json"));
    (dir, store)
}

fn colors(s: &NodeTagStorage) -> Vec<(String, String)> {
    let mut colors: Vec<(String, String)> = s.colors().into_iter().collect();
    colors.sort();
    colors
}

#[test]
fn colors_lists_each_tagged_node_by_its_key() {
    let (_dir, s) = store();
    s.set("c 1/db.ü", "blue").unwrap();
    s.set("c 1/db.ü/orders", "green").unwrap();
    assert_eq!(colors(&s), vec![
        (String::from("c 1/db.ü"), String::from("blue")),
        (String::from("c 1/db.ü/orders"), String::from("green")),
    ]);
}

#[test]
fn a_cleared_tag_is_hidden_and_kept_on_disk_without_its_colour() {
    let (dir, s) = store();
    s.set("c 1/db", "purple").unwrap();
    s.clear("c 1/db").unwrap();
    assert!(s.colors().is_empty());
    let on_disk = std::fs::read_to_string(dir.path().join("node_tags.json")).unwrap();
    assert!(on_disk.contains(r#""deleted": true"#));
    assert!(!on_disk.contains("purple"));
}

#[test]
fn removing_a_connection_marks_only_its_tags_deleted() {
    let (_dir, s) = store();
    s.set("c 1/db", "blue").unwrap();
    s.set("c 10/db", "green").unwrap();
    s.remove_connection("c 1").unwrap();
    assert_eq!(colors(&s), vec![(String::from("c 10/db"), String::from("green"))]);
}

#[test]
fn tagging_a_cleared_node_again_brings_the_tag_back() {
    let (_dir, s) = store();
    s.set("c/db", "blue").unwrap();
    s.clear("c/db").unwrap();
    s.set("c/db", "red").unwrap();
    assert_eq!(colors(&s), vec![(String::from("c/db"), String::from("red"))]);
}

#[test]
fn tags_stored_as_bare_colours_still_load() {
    let (dir, s) = store();
    std::fs::write(dir.path().join("node_tags.json"), r#"{ "c/db": "blue" }"#).unwrap();
    assert_eq!(colors(&s), vec![(String::from("c/db"), String::from("blue"))]);
    assert_eq!(s.load()["c/db"].stamp.updated_at, 0);
}
