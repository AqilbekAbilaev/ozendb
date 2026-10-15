// Merges this device's synced stores with the copy downloaded from another device.
// Every rule here decides whether a deletion or an edit survives, so a mistake is
// data loss: each rule has its test in merge.test.rs.

use crate::record::{Record, Stamp, Stamped};
use crate::settings::StampedSettings;
use crate::storage::ConnectionConfig;
use crate::sync::local_only::without_local_only;
use serde::Serialize;
use std::collections::HashMap;

/// How long a deleted marker is kept. Every device that syncs within this time sees it;
/// a device that doesn't takes the remote copy instead of merging (see `stale`).
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
    pub fn records<R: Record + Serialize>(&self, local: Vec<R>, remote: Vec<R>) -> Vec<R> {
        let mut merged = if self.stale() { Vec::new() } else { local };
        for theirs in remote {
            // ponytail: linear search per record; synced lists hold hundreds at most.
            match merged.iter_mut().find(|mine| mine.id() == theirs.id()) {
                Some(mine) => {
                    if outranks(&theirs, mine) {
                        *mine = theirs;
                    }
                }
                None => merged.push(theirs),
            }
        }
        merged.retain(|record| self.keeps(record.stamp()));
        merged
    }

    /// The two maps merged key by key, by the same rules as `records`.
    pub fn keyed<V: Stamped + Serialize>(&self, local: HashMap<String, V>, remote: HashMap<String, V>) -> HashMap<String, V> {
        let mut merged = if self.stale() { HashMap::new() } else { local };
        for (key, theirs) in remote {
            if merged.get(&key).is_none_or(|mine| outranks(&theirs, mine)) {
                merged.insert(key, theirs);
            }
        }
        merged.retain(|_, value| self.keeps(value.stamp()));
        merged
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
        for (key, theirs) in without_local_only(remote.values.to_map()) {
            let their_stamp = remote.stamp_of(&key);
            let wins = match values.get(&key) {
                Some(mine) => rank(&live(their_stamp), &theirs) > rank(&live(local.stamp_of(&key)), mine),
                None => true,
            };
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

    fn keeps(&self, stamp: &Stamp) -> bool {
        !stamp.deleted || self.now - stamp.updated_at <= MARKER_LIFETIME_MS
    }
}

fn outranks<T: Stamped + Serialize>(theirs: &T, mine: &T) -> bool {
    rank(theirs.stamp(), theirs) > rank(mine.stamp(), mine)
}

fn live(updated_at: i64) -> Stamp {
    Stamp { updated_at, deleted: false }
}

/// Newer wins; on a tie, a deletion wins, so a tie never brings back a deleted record.
/// Two different values stamped alike — typically both saved before stamps existed —
/// are decided by their content, so every device picks the same one.
fn rank<T: Serialize>(stamp: &Stamp, value: &T) -> (i64, bool, String) {
    match serde_json::to_string(value) {
        Ok(content) => (stamp.updated_at, stamp.deleted, content),
        Err(error) => unreachable!("a synced value always serializes: {error}"),
    }
}

#[cfg(test)]
#[path = "merge.test.rs"]
mod tests;
