use super::*;
use crate::settings::Settings;
use serde_json::json;

fn settings_map(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => panic!("settings must serialize to a JSON object"),
    }
}

#[test]
fn every_local_only_key_names_a_real_setting() {
    let settings = settings_map(serde_json::to_value(Settings::default()).unwrap());
    for key in LOCAL_ONLY {
        assert!(settings.contains_key(*key), "no setting named {key}");
    }
}

#[test]
fn drops_the_zoom_level() {
    let settings = settings_map(json!({ "ui_zoom": 1.25, "theme": "light" }));
    assert_eq!(without_local_only(settings), settings_map(json!({ "theme": "light" })));
}

#[test]
fn keeps_every_setting_that_is_not_local_only() {
    let settings = settings_map(json!({
        "default_query_limit": 200,
        "theme": "light",
        "default_result_view": "tree",
        "restore_session": false,
        "editor_tab_width": 2,
        "a key from a newer version": "ünïcode",
    }));
    assert_eq!(without_local_only(settings.clone()), settings);
}
