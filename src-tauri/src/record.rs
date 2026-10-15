// Records in the stores that sync between devices. Sync merges a store record by
// record, keyed by id, and the newer `updated_at` wins. So a delete can't simply
// remove a record — another device still holding it would bring it back — it marks
// the record `deleted` instead, and every read hides it. The mark keeps only the id:
// a deleted record's content leaves the disk as it would have without tombstones.

use crate::time::now_epoch_ms;
use serde::{Deserialize, Serialize};

/// When a record last changed, and whether that change deleted it. Flattened into
/// each record, so every synced file carries the same two keys.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Stamp {
    // Files written before stamps existed load as 0 and not deleted: older than any
    // real edit, so an untouched old copy never beats a change made on another device.
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub deleted: bool,
}

impl Stamp {
    pub fn now() -> Self {
        Stamp { updated_at: now_epoch_ms(), deleted: false }
    }

    fn tombstone() -> Self {
        Stamp { updated_at: now_epoch_ms(), deleted: true }
    }
}

pub trait Record {
    /// What identifies the record across devices.
    fn id(&self) -> String;
    fn stamp(&self) -> &Stamp;
    fn restamp(&mut self, stamp: Stamp);
    /// The same record with everything but its id blanked.
    fn emptied(&self) -> Self;
}

/// The only ways a synced list changes, so no change can skip its stamp.
pub trait RecordList<R> {
    /// The records a user can see.
    fn live(self) -> Vec<R>;
    /// Adds `record` at `index`, replacing any tombstone with its id: re-creating a
    /// deleted record is a newer change than the deletion, so it wins the merge.
    fn put(&mut self, index: usize, record: R);
    fn edit_where(&mut self, which: impl Fn(&R) -> bool, change: impl FnMut(&mut R));
    /// Changes state that belongs to this device alone, so it never syncs: no stamp.
    fn edit_device_only(&mut self, id: &str, change: impl FnOnce(&mut R));
    fn delete_where(&mut self, doomed: impl Fn(&R) -> bool);
}

impl<R: Record> RecordList<R> for Vec<R> {
    fn live(self) -> Vec<R> {
        self.into_iter().filter(|r| !r.stamp().deleted).collect()
    }

    fn put(&mut self, index: usize, mut record: R) {
        let id = record.id();
        self.retain(|r| r.id() != id);
        record.restamp(Stamp::now());
        self.insert(index.min(self.len()), record);
    }

    fn edit_where(&mut self, which: impl Fn(&R) -> bool, mut change: impl FnMut(&mut R)) {
        for record in self.iter_mut().filter(|r| !r.stamp().deleted && which(r)) {
            change(record);
            record.restamp(Stamp::now());
        }
    }

    fn edit_device_only(&mut self, id: &str, change: impl FnOnce(&mut R)) {
        if let Some(record) = self.iter_mut().find(|r| r.id() == id && !r.stamp().deleted) {
            change(record);
        }
    }

    fn delete_where(&mut self, doomed: impl Fn(&R) -> bool) {
        for record in self.iter_mut().filter(|r| !r.stamp().deleted && doomed(r)) {
            *record = record.emptied();
            record.restamp(Stamp::tombstone());
        }
    }
}

#[cfg(test)]
#[path = "record.test.rs"]
mod tests;
