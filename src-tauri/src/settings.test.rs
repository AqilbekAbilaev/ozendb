use super::*;
use std::collections::BTreeMap;
use tempfile::tempdir;

fn stamped(theme: &str, updated_at: &[(&str, i64)]) -> StampedSettings {
    StampedSettings {
        values: Settings { theme: theme.to_string(), ..Settings::default() },
        updated_at: updated_at.iter().map(|(key, at)| (key.to_string(), *at)).collect(),
    }
}

#[test]
fn a_changed_setting_takes_the_new_stamp() {
    let changed = stamped("dark", &[]).changed_to(Settings { theme: String::from("light"), ..Settings::default() }, 42);
    assert_eq!(changed.values.theme, "light");
    assert_eq!(changed.updated_at, BTreeMap::from([(String::from("theme"), 42)]));
}

#[test]
fn an_unchanged_setting_keeps_its_stamp() {
    let changed = stamped("dark", &[("theme", 7)]).changed_to(Settings { editor_tab_width: 2, ..Settings::default() }, 42);
    assert_eq!(changed.updated_at["theme"], 7);
    assert_eq!(changed.updated_at["editor_tab_width"], 42);
}

#[test]
fn a_settings_file_written_before_stamps_loads_every_setting_at_zero() {
    let loaded: StampedSettings = serde_json::from_str(r#"{ "theme": "light", "ui_zoom": 1.25 }"#).unwrap();
    assert_eq!(loaded.values.theme, "light");
    assert_eq!(loaded.values.ui_zoom, 1.25);
    assert_eq!(loaded.stamp_of("theme"), 0);
}

#[test]
fn the_stamps_are_written_beside_the_settings() {
    let json = serde_json::to_value(stamped("light", &[("theme", 42)])).unwrap();
    assert_eq!(json["theme"], "light");
    assert_eq!(json["updated_at"]["theme"], 42);
}

#[test]
fn saving_stamps_only_the_settings_that_changed() {
    let dir = tempdir().unwrap();
    let storage = SettingsStorage::new(dir.path().join("settings ü.json"));
    let before = crate::time::now_epoch_ms();
    storage.save(&Settings { theme: String::from("light"), ..Settings::default() }).unwrap();
    let saved = storage.load();
    assert_eq!(storage.settings().theme, "light");
    assert!(saved.stamp_of("theme") >= before);
    assert_eq!(saved.stamp_of("editor_tab_width"), 0);
}
