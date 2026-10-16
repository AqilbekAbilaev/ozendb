// Merges this device's synced stores with the copy downloaded from another device.
// Every rule here decides whether a deletion or an edit survives, so a mistake is
// data loss: each rule has its test in merge.test.rs.

use crate::record::{Record, Stamp, Stamped};
use crate::settings::{Settings, StampedSettings};
use crate::storage::ConnectionConfig;
use crate::sync::local_only::without_local_only;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

/// How long a deleted marker is kept after it first reached the server. Every device
/// that syncs within this time sees it; one that doesn't takes the remote copy instead
/// of merging (see `stale`).
const MARKER_LIFETIME_MS: i64 = 90 * 24 * 60 * 60 * 1000;

/// One merge, at `now`, on a device whose last successful sync was at `last_sync`
/// (`None` if it has never synced).
pub struct Merge {
    now: i64,
    last_sync: Option<i64>,
}

impl Merge {
    pub fn new(now: i64, last_sync: Option<i64>) -> Self {
        Merge { now, last_sync }
    }

    /// The two lists merged record by record. Local order is kept; records new to this
    /// device follow in the remote order.
    pub fn records<R: Record + Serialize + Clone>(&self, local: Vec<R>, remote: Vec<R>) -> Vec<R> {
        let mut merged = if self.stale() { Vec::new() } else { local };
        for theirs in remote {
            // ponytail: linear search per record; synced lists hold hundreds at most.
            match merged.iter_mut().find(|mine| mine.id() == theirs.id()) {
                Some(mine) => *mine = winner(mine.clone(), theirs),
                None => merged.push(theirs),
            }
        }
        merged.into_iter().filter_map(|record| self.uploaded(record)).collect()
    }

    /// The two maps merged key by key, by the same rules as `records`.
    pub fn keyed<V: Stamped + Serialize>(&self, local: HashMap<String, V>, remote: HashMap<String, V>) -> HashMap<String, V> {
        let mut merged = if self.stale() { HashMap::new() } else { local };
        for (key, theirs) in remote {
            let won = match merged.remove(&key) {
                Some(mine) => winner(mine, theirs),
                None => theirs,
            };
            merged.insert(key, won);
        }
        merged.into_iter().filter_map(|(key, value)| Some((key, self.uploaded(value)?))).collect()
    }

    /// Connections merge as records, except that whether a connection is open and when
    /// it was last used belong to this device and never come from another.
    pub fn connections(&self, local: Vec<ConnectionConfig>, remote: Vec<ConnectionConfig>) -> Vec<ConnectionConfig> {
        let remote = remote
            .into_iter()
            .map(|mut theirs| {
                let mine = local.iter().find(|mine| mine.id == theirs.id && !theirs.stamp.deleted);
                theirs.open = mine.is_some_and(|mine| mine.open);
                theirs.last_accessed = mine.and_then(|mine| mine.last_accessed.clone());
                theirs
            })
            .collect();
        self.records(local, remote)
    }

    /// Settings merge one by one, the newer value winning. Local-only settings never
    /// take another device's value.
    pub fn settings(&self, local: StampedSettings, remote: StampedSettings) -> StampedSettings {
        let mut values = local.values.to_map();
        let mut updated_at = local.updated_at.clone();
        let defaults = Settings::default().to_map();
        for (key, theirs) in without_local_only(remote.values.to_map()) {
            let their_stamp = remote.stamp_of(&key);
            let default = defaults.get(&key);
            let wins = values.get(&key).is_none_or(|mine| {
                setting_rank(their_stamp, &theirs, default) > setting_rank(local.stamp_of(&key), mine, default)
            });
            if self.stale() || wins {
                values.insert(key.clone(), theirs);
                updated_at.insert(key, their_stamp);
            }
        }
        match serde_json::from_value(serde_json::Value::Object(values)) {
            Ok(values) => StampedSettings { values, updated_at },
            Err(error) => unreachable!("merged settings come from two valid settings: {error}"),
        }
    }

    /// A device that hasn't synced for longer than a marker lives may hold records whose
    /// deletion the others have already forgotten; merging would bring them back.
    fn stale(&self) -> bool {
        self.last_sync.is_some_and(|last_sync| self.now - last_sync > MARKER_LIFETIME_MS)
    }

    /// The value as the merge sends it up: a marker the server hasn't had yet starts its
    /// 90 days now, and one whose 90 days are over is erased (`None`).
    fn uploaded<V: Stamped>(&self, mut value: V) -> Option<V> {
        let stamp = value.stamp().clone();
        if !stamp.deleted {
            return Some(value);
        }
        let uploaded_at = stamp.uploaded_at.unwrap_or(self.now);
        if self.now - uploaded_at > MARKER_LIFETIME_MS {
            return None;
        }
        value.restamp(Stamp { uploaded_at: Some(uploaded_at), ..stamp });
        Some(value)
    }
}

/// The copy that wins. Two copies of one marker (the same deletion) keep the earliest
/// time it reached the server, so its 90 days never restart. The upload time never
/// picks the winner: copies that differ only in it are copies of one marker.
fn winner<T: Stamped + Serialize>(mine: T, theirs: T) -> T {
    let (a, b) = (mine.stamp().clone(), theirs.stamp().clone());
    let mut won = if outranks(&theirs, &mine) { theirs } else { mine };
    if a.deleted && b.deleted && a.updated_at == b.updated_at {
        let first = a.uploaded_at.into_iter().chain(b.uploaded_at).min();
        won.restamp(Stamp { uploaded_at: first, ..won.stamp().clone() });
    }
    won
}

fn outranks<T: Stamped + Serialize>(theirs: &T, mine: &T) -> bool {
    rank(theirs) > rank(mine)
}

/// Newer wins; on a tie, a deletion wins, so a tie never brings back a deleted record.
/// Two different values stamped alike — typically both saved before stamps existed —
/// are decided by their content, so every device picks the same one.
fn rank<T: Stamped + Serialize>(record: &T) -> (i64, bool, String) {
    (record.stamp().updated_at, record.stamp().deleted, content(record))
}

/// Newer wins. A setting never changed since stamps existed is at 0 on every device,
/// fresh installs included; there a customised value beats the default, so a new
/// device can't reset another's settings. Two customised values fall to content.
fn setting_rank(updated_at: i64, value: &Value, default: Option<&Value>) -> (i64, bool, String) {
    (updated_at, updated_at == 0 && Some(value) != default, content(value))
}

// The same answer on every device only while no synced type holds a `HashMap`, whose
// key order changes between runs.
fn content<T: Serialize>(value: &T) -> String {
    match serde_json::to_string(value) {
        Ok(content) => content,
        Err(error) => unreachable!("a synced value always serializes: {error}"),
    }
}

#[cfg(test)]
#[path = "merge.test.rs"]
mod tests;
