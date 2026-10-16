use super::{Folder, FolderStorage};
use crate::record::Stamp;
use tempfile::tempdir;

fn folder(id: &str, name: &str) -> Folder {
    Folder { id: id.to_string(), name: name.to_string(), parent_id: None, created_at: String::from("1"), stamp: Stamp::now() }
}

fn names(store: &FolderStorage) -> Vec<String> {
    store.load().into_iter().map(|f| f.name).collect()
}

#[test]
fn a_deleted_folder_is_hidden_and_kept_on_disk_without_its_name() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("folders.json");
    let store = FolderStorage::new(path.clone());
    store.insert(folder("f/1", "Prod servers")).unwrap();
    store.insert(folder("f.2", "Ünïcode")).unwrap();
    store.delete("f/1").unwrap();
    assert_eq!(names(&store), vec!["Ünïcode"]);
    let on_disk = std::fs::read_to_string(&path).unwrap();
    assert!(on_disk.contains(r#""id": "f/1""#));
    assert!(on_disk.contains(r#""deleted": true"#));
    assert!(!on_disk.contains("Prod servers"));
}

#[test]
fn renaming_a_folder_stamps_it() {
    let dir = tempdir().unwrap();
    let store = FolderStorage::new(dir.path().join("folders.json"));
    let mut old = folder("f 1", "Old name");
    old.stamp = Stamp { updated_at: 5, ..Stamp::default() };
    store.inner.save(&vec![old]).unwrap();
    store.rename("f 1", "New name").unwrap();
    let renamed = &store.load()[0];
    assert_eq!(renamed.name, "New name");
    assert!(renamed.stamp.updated_at > 5);
}

#[test]
fn a_folders_file_written_before_stamps_existed_still_loads() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("folders.json");
    std::fs::write(&path, r#"[{ "id": "f1", "name": "Legacy", "parent_id": null, "created_at": "1" }]"#).unwrap();
    assert_eq!(names(&FolderStorage::new(path)), vec!["Legacy"]);
}
