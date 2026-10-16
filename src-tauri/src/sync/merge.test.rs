use super::*;
use crate::default_queries::DefaultQuery;
use crate::folders::Folder;
use crate::known_hosts::KnownHost;
use crate::node_tags::NodeTag;
use crate::postgres::query_library::SavedSql;
use crate::record::{RecordList, Stamp};
use crate::saved_queries::SavedQueryEntry;
use crate::settings::Settings;
use serde_json::json;
use std::collections::BTreeMap;

const DAY: i64 = 24 * 60 * 60 * 1000;
const NOW: i64 = 1_000 * DAY;
// Recent enough that no deleted marker stamped near it is erased.
const T: i64 = NOW - DAY;

fn merge() -> Merge {
    Merge::new(NOW, Some(NOW - DAY))
}

fn stamp(updated_at: i64, deleted: bool) -> Stamp {
    Stamp { updated_at, deleted, uploaded_at: None }
}

/// The marker as the server holds it, first uploaded at `uploaded_at`.
fn sent(mut marker: Folder, uploaded_at: Option<i64>) -> Folder {
    marker.stamp.uploaded_at = uploaded_at;
    marker
}

fn uploaded_at(folders: &[Folder]) -> Vec<Option<i64>> {
    folders.iter().map(|f| f.stamp.uploaded_at).collect()
}

fn folder(id: &str, name: &str, updated_at: i64) -> Folder {
    Folder { id: id.to_string(), name: name.to_string(), stamp: stamp(updated_at, false), ..Folder::default() }
}

fn deleted(id: &str, updated_at: i64) -> Folder {
    Folder { id: id.to_string(), stamp: stamp(updated_at, true), ..Folder::default() }
}

fn names(folders: &[Folder]) -> Vec<String> {
    folders.iter().map(|f| if f.stamp.deleted { format!("{} (deleted)", f.id) } else { f.name.clone() }).collect()
}

// --- Records in a list -----------------------------------------------------------

#[test]
fn a_newer_remote_edit_wins() {
    let merged = merge().records(vec![folder("f 1", "old name", 5)], vec![folder("f 1", "new name", 9)]);
    assert_eq!(names(&merged), vec!["new name"]);
}

#[test]
fn a_newer_local_edit_wins() {
    let merged = merge().records(vec![folder("f 1", "new name", 9)], vec![folder("f 1", "old name", 5)]);
    assert_eq!(names(&merged), vec!["new name"]);
}

#[test]
fn on_a_tie_the_deleted_record_wins_whichever_side_holds_it() {
    let local_deleted = merge().records(vec![deleted("f 1", T)], vec![folder("f 1", "name", T)]);
    let remote_deleted = merge().records(vec![folder("f 1", "name", T)], vec![deleted("f 1", T)]);
    assert_eq!(names(&local_deleted), vec!["f 1 (deleted)"]);
    assert_eq!(names(&remote_deleted), vec!["f 1 (deleted)"]);
}

#[test]
fn a_delete_beats_an_older_edit() {
    let merged = merge().records(vec![folder("f 1", "edited", T)], vec![deleted("f 1", T + 1)]);
    assert_eq!(names(&merged), vec!["f 1 (deleted)"]);
}

#[test]
fn an_edit_beats_an_older_delete() {
    let merged = merge().records(vec![deleted("f 1", T)], vec![folder("f 1", "edited", T + 1)]);
    assert_eq!(names(&merged), vec!["edited"]);
}

#[test]
fn a_record_re_created_after_its_delete_comes_back() {
    let remote = vec![deleted("same id", T)];
    let local = vec![folder("same id", "again", T + 1)];
    assert_eq!(names(&merge().records(local.clone(), remote.clone())), vec!["again"]);
    assert_eq!(names(&merge().records(remote, local)), vec!["again"]);
}

#[test]
fn a_record_on_one_side_only_is_kept() {
    let merged = merge().records(vec![folder("mine", "only here", 1)], vec![folder("theirs", "only there", 1)]);
    assert_eq!(names(&merged), vec!["only here", "only there"]);
}

#[test]
fn local_order_is_kept_and_new_remote_records_follow_in_remote_order() {
    let local = vec![folder("b", "b", 1), folder("a", "a", 1)];
    let remote = vec![folder("d", "d", 1), folder("a", "a", 1), folder("c", "c", 1)];
    assert_eq!(names(&merge().records(local, remote)), vec!["b", "a", "d", "c"]);
}

#[test]
fn a_marker_first_uploaded_over_ninety_days_ago_is_erased() {
    let local = vec![sent(deleted("old", NOW - 200 * DAY), Some(NOW - 91 * DAY))];
    let remote = vec![sent(deleted("older", NOW - 300 * DAY), Some(NOW - 200 * DAY))];
    assert!(merge().records(local, remote).is_empty());
}

#[test]
fn a_marker_counts_its_ninety_days_from_its_first_upload_not_its_deletion() {
    let merged = merge().records(vec![sent(deleted("deleted long ago", NOW - 200 * DAY), Some(NOW - 89 * DAY))], vec![]);
    assert_eq!(names(&merged), vec!["deleted long ago (deleted)"]);
}

#[test]
fn a_marker_never_uploaded_is_never_erased_and_starts_its_ninety_days_now() {
    let merged = merge().records(vec![deleted("offline delete", NOW - 200 * DAY)], vec![]);
    assert_eq!(names(&merged), vec!["offline delete (deleted)"]);
    assert_eq!(uploaded_at(&merged), vec![Some(NOW)]);
}

#[test]
fn a_marker_already_on_the_server_keeps_its_upload_time() {
    let merged = merge().records(vec![], vec![sent(deleted("r", T), Some(T + 5))]);
    assert_eq!(uploaded_at(&merged), vec![Some(T + 5)]);
}

#[test]
fn two_copies_of_one_marker_keep_the_earliest_upload_time() {
    let early = vec![sent(deleted("r", T), Some(T + 5))];
    let late = vec![sent(deleted("r", T), Some(T + 9))];
    assert_eq!(uploaded_at(&merge().records(early.clone(), late.clone())), vec![Some(T + 5)]);
    assert_eq!(uploaded_at(&merge().records(late, early)), vec![Some(T + 5)]);
}

#[test]
fn a_newer_marker_starts_its_own_ninety_days() {
    let merged = merge().records(vec![sent(deleted("r", T), Some(T + 5))], vec![deleted("r", T + 1)]);
    assert_eq!(merged[0].stamp.updated_at, T + 1);
    assert_eq!(uploaded_at(&merged), vec![Some(NOW)]);
}

#[test]
fn the_upload_time_never_decides_which_copy_wins() {
    let merged = merge().records(vec![sent(deleted("r", T), Some(T - 9 * DAY))], vec![folder("r", "edited", T + 1)]);
    assert_eq!(names(&merged), vec!["edited"]);
    assert_eq!(uploaded_at(&merged), vec![None]);
}

#[test]
fn a_marker_uploaded_late_still_reaches_a_device_that_synced_before_the_upload() {
    let day = |n: i64| NOW + n * DAY;
    let on_a = vec![deleted("r", day(0))];
    let on_c = vec![folder("r", "only on C", day(0) - 1)];
    let server = Merge::new(day(50), Some(day(-1))).records(on_a, vec![]);
    let server = Merge::new(day(95), Some(day(50))).records(server.clone(), server);
    let on_c = Merge::new(day(96), Some(day(10))).records(on_c, server);
    assert_eq!(names(&on_c), vec!["r (deleted)"]);
}

#[test]
fn an_old_live_record_is_never_erased() {
    let merged = merge().records(vec![folder("from an old file", "kept", 0)], vec![]);
    assert_eq!(names(&merged), vec!["kept"]);
}

#[test]
fn a_device_that_last_synced_over_ninety_days_ago_takes_the_remote_copy() {
    let stale = Merge::new(NOW, Some(NOW - 91 * DAY));
    let local = vec![folder("purged elsewhere", "would come back", 9), folder("shared", "newer here", NOW)];
    let remote = vec![folder("shared", "remote", 5), sent(deleted("gone", NOW - DAY), Some(NOW - DAY))];
    assert_eq!(names(&stale.records(local, remote)), vec!["remote", "gone (deleted)"]);
}

#[test]
fn a_stale_device_still_erases_old_markers_from_the_remote_copy() {
    let stale = Merge::new(NOW, Some(NOW - 91 * DAY));
    assert!(stale.records(vec![], vec![sent(deleted("old", NOW - 92 * DAY), Some(NOW - 91 * DAY))]).is_empty());
}

#[test]
fn a_device_that_never_synced_merges() {
    let first = Merge::new(NOW, None);
    let merged = first.records(vec![folder("mine", "kept", 1)], vec![folder("theirs", "added", 1)]);
    assert_eq!(names(&merged), vec!["kept", "added"]);
}

#[test]
fn records_saved_before_stamps_existed_merge_the_same_way_on_both_devices() {
    let here = vec![folder("f 1", "named here", 0)];
    let there = vec![folder("f 1", "named there", 0)];
    assert_eq!(names(&merge().records(here.clone(), there.clone())), names(&merge().records(there, here)));
}

#[test]
fn known_hosts_merge_by_address() {
    let host = |key: &str, updated_at| KnownHost {
        host: String::from("bastion.ü.example"),
        port: 2222,
        key: key.to_string(),
        stamp: stamp(updated_at, false),
        ..KnownHost::default()
    };
    let merged = merge().records(vec![host("ssh-ed25519 OLD", 1)], vec![host("ssh-ed25519 NEW", 2)]);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].key, "ssh-ed25519 NEW");
}

#[test]
fn saved_queries_and_saved_sql_merge_by_id() {
    let query = |name: &str, updated_at| SavedQueryEntry {
        id: String::from("q/1"),
        name: name.to_string(),
        stamp: stamp(updated_at, false),
        ..SavedQueryEntry::default()
    };
    let sql = |name: &str, updated_at| SavedSql {
        id: String::from("s.1"),
        name: name.to_string(),
        stamp: stamp(updated_at, false),
        ..SavedSql::default()
    };
    assert_eq!(merge().records(vec![query("old", 1)], vec![query("new", 2)])[0].name, "new");
    assert_eq!(merge().records(vec![sql("new", 2)], vec![sql("old", 1)])[0].name, "new");
}

// --- Records in a map ------------------------------------------------------------

fn tag(color: &str, updated_at: i64, deleted: bool) -> NodeTag {
    NodeTag { color: color.to_string(), stamp: stamp(updated_at, deleted) }
}

fn tags(entries: &[(&str, NodeTag)]) -> HashMap<String, NodeTag> {
    entries.iter().map(|(key, tag)| (key.to_string(), tag.clone())).collect()
}

fn colors(map: &HashMap<String, NodeTag>) -> Vec<(String, String)> {
    let mut colors: Vec<_> = map
        .iter()
        .map(|(key, tag)| (key.clone(), if tag.stamp.deleted { String::from("(deleted)") } else { tag.color.clone() }))
        .collect();
    colors.sort();
    colors
}

#[test]
fn keyed_records_merge_key_by_key_with_the_same_rules() {
    let local = tags(&[("c 1/db.ü", tag("blue", 5, false)), ("c 1/kept", tag("red", 1, false)), ("c 1/tie", tag("", T, true))]);
    let remote = tags(&[("c 1/db.ü", tag("green", 9, false)), ("c 1/new", tag("teal", 1, false)), ("c 1/tie", tag("pink", T, false))]);
    assert_eq!(
        colors(&merge().keyed(local, remote)),
        vec![
            (String::from("c 1/db.ü"), String::from("green")),
            (String::from("c 1/kept"), String::from("red")),
            (String::from("c 1/new"), String::from("teal")),
            (String::from("c 1/tie"), String::from("(deleted)")),
        ]
    );
}

#[test]
fn keyed_markers_are_erased_ninety_days_after_their_first_upload() {
    let mut old = tag("", NOW - 200 * DAY, true);
    old.stamp.uploaded_at = Some(NOW - 91 * DAY);
    let merged = merge().keyed(tags(&[("c/old", old), ("c/never sent", tag("", NOW - 200 * DAY, true))]), HashMap::new());
    assert_eq!(merged.into_iter().map(|(key, tag)| (key, tag.stamp.uploaded_at)).collect::<Vec<_>>(), vec![(String::from("c/never sent"), Some(NOW))]);
}

#[test]
fn a_stale_device_takes_the_remote_keyed_records() {
    let stale = Merge::new(NOW, Some(NOW - 91 * DAY));
    let merged = stale.keyed(tags(&[("c/mine", tag("blue", NOW, false))]), tags(&[("c/theirs", tag("red", 1, false))]));
    assert_eq!(colors(&merged), vec![(String::from("c/theirs"), String::from("red"))]);
}

#[test]
fn default_queries_merge_by_key() {
    let query = |filter: &str, updated_at| DefaultQuery { filter: filter.to_string(), stamp: stamp(updated_at, false), ..DefaultQuery::default() };
    let key = String::from("c 1::db::coll.ü");
    let merged = merge().keyed(HashMap::from([(key.clone(), query("{}", 1))]), HashMap::from([(key.clone(), query("{\"a\":1}", 2))]));
    assert_eq!(merged[&key].filter, "{\"a\":1}");
}

// --- Connections -----------------------------------------------------------------

fn connection(name: &str, updated_at: i64, open: bool, last_accessed: Option<&str>) -> ConnectionConfig {
    ConnectionConfig {
        id: String::from("conn 1"),
        name: name.to_string(),
        open,
        last_accessed: last_accessed.map(str::to_string),
        stamp: stamp(updated_at, false),
        ..ConnectionConfig::default()
    }
}

#[test]
fn a_connection_keeps_this_devices_open_state_and_last_access_when_the_remote_wins() {
    let merged = merge().connections(
        vec![connection("old", 1, true, Some("100"))],
        vec![connection("renamed", 2, false, Some("999"))],
    );
    assert_eq!(merged[0].name, "renamed");
    assert!(merged[0].open);
    assert_eq!(merged[0].last_accessed.as_deref(), Some("100"));
}

#[test]
fn a_connection_new_to_this_device_arrives_closed_and_never_accessed() {
    let merged = merge().connections(vec![], vec![connection("from elsewhere", 2, true, Some("999"))]);
    assert!(!merged[0].open);
    assert_eq!(merged[0].last_accessed, None);
}

#[test]
fn a_connection_deleted_elsewhere_stays_blank() {
    let mut remote = vec![connection("doomed", 1, false, None)];
    remote.delete_where(|_| true);
    let merged = merge().connections(vec![connection("doomed", 1, true, Some("100"))], remote);
    assert!(merged[0].stamp.deleted);
    assert!(!merged[0].open);
    assert_eq!(merged[0].last_accessed, None);
}

#[test]
fn a_stale_device_keeps_its_connection_state() {
    let stale = Merge::new(NOW, Some(NOW - 91 * DAY));
    let merged = stale.connections(vec![connection("mine", NOW, true, Some("100"))], vec![connection("theirs", 1, false, None)]);
    assert_eq!(merged[0].name, "theirs");
    assert!(merged[0].open);
    assert_eq!(merged[0].last_accessed.as_deref(), Some("100"));
}

#[test]
fn device_state_alone_does_not_decide_a_tie() {
    let here = vec![connection("same", 3, true, Some("100"))];
    let there = vec![connection("same", 3, false, None)];
    let merged = merge().connections(here.clone(), there.clone());
    assert_eq!(merged[0].name, "same");
    assert!(merged[0].open);
    assert_eq!(merge().connections(there, here)[0].last_accessed, None);
}

// --- Settings --------------------------------------------------------------------

fn settings(values: Settings, updated_at: &[(&str, i64)]) -> StampedSettings {
    StampedSettings { values, updated_at: updated_at.iter().map(|(key, at)| (key.to_string(), *at)).collect() }
}

#[test]
fn settings_merge_key_by_key_and_the_newer_value_wins() {
    let local = settings(Settings { theme: String::from("light"), editor_tab_width: 2, ..Settings::default() }, &[("theme", 9), ("editor_tab_width", 1)]);
    let remote = settings(Settings { theme: String::from("dark"), editor_tab_width: 8, ..Settings::default() }, &[("theme", 5), ("editor_tab_width", 6)]);
    let merged = merge().settings(local, remote);
    assert_eq!(merged.values.theme, "light");
    assert_eq!(merged.values.editor_tab_width, 8);
    assert_eq!(merged.stamp_of("theme"), 9);
    assert_eq!(merged.stamp_of("editor_tab_width"), 6);
}

#[test]
fn a_local_only_setting_never_takes_the_remote_value() {
    let local = settings(Settings { ui_zoom: 1.25, ..Settings::default() }, &[("ui_zoom", 1)]);
    let remote = settings(Settings { ui_zoom: 0.75, ..Settings::default() }, &[("ui_zoom", 9)]);
    let merged = merge().settings(local, remote);
    assert_eq!(merged.values.ui_zoom, 1.25);
    assert_eq!(merged.stamp_of("ui_zoom"), 1);
}

#[test]
fn a_stale_device_takes_the_remote_settings_but_keeps_its_local_only_ones() {
    let stale = Merge::new(NOW, Some(NOW - 91 * DAY));
    let local = settings(Settings { theme: String::from("light"), ui_zoom: 1.5, ..Settings::default() }, &[("theme", NOW), ("ui_zoom", NOW)]);
    let remote = settings(Settings { theme: String::from("dark"), ui_zoom: 0.5, ..Settings::default() }, &[("theme", 1)]);
    let merged = stale.settings(local, remote);
    assert_eq!(merged.values.theme, "dark");
    assert_eq!(merged.stamp_of("theme"), 1);
    assert_eq!(merged.values.ui_zoom, 1.5);
}

#[test]
fn settings_files_from_before_stamps_agree_on_both_devices() {
    let here: StampedSettings = serde_json::from_value(json!({ "theme": "light", "default_query_limit": 200 })).unwrap();
    let there: StampedSettings = serde_json::from_value(json!({ "theme": "dark", "default_query_limit": 50 })).unwrap();
    let one_way = merge().settings(here.clone(), there.clone()).values.to_map();
    let other_way = merge().settings(there, here).values.to_map();
    assert_eq!(one_way, other_way);
}

#[test]
fn a_fresh_device_never_resets_customised_settings_from_an_old_file() {
    let customised: StampedSettings = serde_json::from_value(json!({ "default_query_limit": 200, "editor_tab_width": 2 })).unwrap();
    let fresh = StampedSettings::default();
    for merged in [merge().settings(customised.clone(), fresh.clone()), merge().settings(fresh, customised)] {
        assert_eq!(merged.values.default_query_limit, 200);
        assert_eq!(merged.values.editor_tab_width, 2);
    }
}

#[test]
fn merging_settings_twice_changes_nothing() {
    let local = settings(Settings { theme: String::from("light"), ..Settings::default() }, &[("theme", 9)]);
    let remote = settings(Settings { editor_tab_width: 2, ..Settings::default() }, &[("editor_tab_width", 3)]);
    let once = merge().settings(local, remote.clone());
    let twice = merge().settings(once.clone(), remote);
    assert_eq!(serde_json::to_value(&once).unwrap(), serde_json::to_value(&twice).unwrap());
}

// --- Properties over generated cases ---------------------------------------------

// A small deterministic generator, so every run checks the same cases.
struct Cases(u64);

impl Cases {
    fn next(&mut self, below: u64) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 33) % below
    }

    fn folders(&mut self) -> Vec<Folder> {
        let mut folders = Vec::new();
        for id in ["a", "b/ü", "c d", "e.f"] {
            let updated_at = T + self.next(3) as i64;
            match self.next(3) {
                0 => {}
                1 => folders.push(sent(deleted(id, updated_at), [None, Some(T), Some(T + 1)][self.next(3) as usize])),
                _ => folders.push(folder(id, ["x", "y"][self.next(2) as usize], updated_at)),
            }
        }
        folders
    }

    fn pick<T: Copy>(&mut self, choices: &[T]) -> T {
        choices[self.next(choices.len() as u64) as usize]
    }

    fn tags(&mut self) -> HashMap<String, NodeTag> {
        let mut tags = HashMap::new();
        for key in ["c 1/db", "c 1/db/coll.ü", "d/e f"] {
            let updated_at = T + self.next(3) as i64;
            match self.next(3) {
                0 => {}
                1 => {
                    let mut marker = tag("", updated_at, true);
                    marker.stamp.uploaded_at = self.pick(&[None, Some(T), Some(T + 1)]);
                    tags.insert(key.to_string(), marker);
                }
                _ => {
                    tags.insert(key.to_string(), tag(self.pick(&["blue", "red"]), updated_at, false));
                }
            }
        }
        tags
    }

    fn settings(&mut self) -> StampedSettings {
        if self.next(4) == 0 {
            return StampedSettings::default();
        }
        let values = Settings {
            theme: String::from(self.pick(&["dark", "light"])),
            default_query_limit: self.pick(&[50, 200, 1000]),
            editor_tab_width: self.pick(&[2, 4, 8]),
            ui_zoom: self.pick(&[1.0, 1.25]),
            ..Settings::default()
        };
        let mut updated_at = BTreeMap::new();
        for key in ["theme", "default_query_limit", "editor_tab_width", "ui_zoom"] {
            updated_at.insert(key.to_string(), self.pick(&[0, T, T + 1]));
        }
        StampedSettings { values, updated_at }
    }
}

fn by_key(tags: HashMap<String, NodeTag>) -> serde_json::Value {
    let mut tags: Vec<_> = tags.into_iter().collect();
    tags.sort_by(|a, b| a.0.cmp(&b.0));
    serde_json::to_value(tags).unwrap()
}

/// What of the settings crosses devices: each synced setting's value and stamp.
fn synced(settings: &StampedSettings) -> Vec<(String, i64, serde_json::Value)> {
    without_local_only(settings.values.to_map())
        .into_iter()
        .map(|(key, value)| (key.clone(), settings.stamp_of(&key), value))
        .collect()
}

fn by_id(mut folders: Vec<Folder>) -> serde_json::Value {
    folders.sort_by(|a, b| a.id.cmp(&b.id));
    serde_json::to_value(folders).unwrap()
}

#[test]
fn merging_is_symmetric_idempotent_and_order_free_for_generated_cases() {
    let mut cases = Cases(317);
    for _ in 0..2_000 {
        let (a, b, c) = (cases.folders(), cases.folders(), cases.folders());
        let ab = merge().records(a.clone(), b.clone());
        assert_eq!(by_id(ab.clone()), by_id(merge().records(b.clone(), a.clone())), "symmetric for {a:?} and {b:?}");
        assert_eq!(by_id(merge().records(ab.clone(), b.clone())), by_id(ab.clone()), "idempotent for {a:?} and {b:?}");
        assert_eq!(by_id(merge().records(ab.clone(), ab.clone())), by_id(ab.clone()), "self merge for {ab:?}");
        let ab_c = merge().records(ab, c.clone());
        let a_bc = merge().records(a.clone(), merge().records(b.clone(), c.clone()));
        assert_eq!(by_id(ab_c), by_id(a_bc), "associative for {a:?}, {b:?} and {c:?}");
    }
}

#[test]
fn keyed_merging_is_symmetric_idempotent_and_order_free_for_generated_cases() {
    let mut cases = Cases(342);
    for _ in 0..2_000 {
        let (a, b, c) = (cases.tags(), cases.tags(), cases.tags());
        let ab = merge().keyed(a.clone(), b.clone());
        assert_eq!(by_key(ab.clone()), by_key(merge().keyed(b.clone(), a.clone())), "symmetric for {a:?} and {b:?}");
        assert_eq!(by_key(merge().keyed(ab.clone(), b.clone())), by_key(ab.clone()), "idempotent for {a:?} and {b:?}");
        assert_eq!(by_key(merge().keyed(ab.clone(), ab.clone())), by_key(ab.clone()), "self merge for {ab:?}");
        let a_bc = merge().keyed(a.clone(), merge().keyed(b.clone(), c.clone()));
        assert_eq!(by_key(merge().keyed(ab, c.clone())), by_key(a_bc), "associative for {a:?}, {b:?} and {c:?}");
    }
}

#[test]
fn settings_merging_is_symmetric_idempotent_and_order_free_for_generated_cases() {
    let mut cases = Cases(316);
    for _ in 0..2_000 {
        let (a, b, c) = (cases.settings(), cases.settings(), cases.settings());
        let ab = merge().settings(a.clone(), b.clone());
        assert_eq!(ab.values.ui_zoom, a.values.ui_zoom, "local-only kept for {a:?} and {b:?}");
        assert_eq!(synced(&ab), synced(&merge().settings(b.clone(), a.clone())), "symmetric for {a:?} and {b:?}");
        assert_eq!(synced(&merge().settings(ab.clone(), b.clone())), synced(&ab), "idempotent for {a:?} and {b:?}");
        assert_eq!(synced(&merge().settings(ab.clone(), ab.clone())), synced(&ab), "self merge for {ab:?}");
        let a_bc = merge().settings(a.clone(), merge().settings(b.clone(), c.clone()));
        assert_eq!(synced(&merge().settings(ab, c.clone())), synced(&a_bc), "associative for {a:?}, {b:?} and {c:?}");
    }
}

#[test]
fn a_fresh_device_keeps_every_customised_setting_it_merges_with() {
    let mut cases = Cases(7);
    for _ in 0..500 {
        let other = cases.settings();
        let fresh = merge().settings(StampedSettings::default(), other.clone());
        assert_eq!(synced(&fresh), synced(&merge().settings(other.clone(), other.clone())), "fresh device against {other:?}");
    }
}
