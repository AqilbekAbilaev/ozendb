// The signal that something which syncs was edited on this device, so a sync can follow
// a few minutes later. It is raised where a synced record takes a new stamp
// (record.rs) and where a shared setting changes (settings.rs), not where files are
// written: the sync's own write-back keeps the merged stamps and must not schedule
// another sync, and the files also hold device-only state (query runs, open
// connections) that never syncs. A process global, as in error_log.rs, because the
// record helpers run inside the stores with no app state in reach.

use std::sync::LazyLock;
use tokio::sync::watch;

// How many edits this run of the app has seen. Only its changes matter.
static EDITS: LazyLock<watch::Sender<u64>> = LazyLock::new(|| watch::Sender::new(0));

/// Tells whoever watches that synced data was just edited.
pub fn note() {
    EDITS.send_modify(|count| *count += 1);
}

/// A receiver that wakes on every edit noted from now on.
pub fn subscribe() -> watch::Receiver<u64> {
    EDITS.subscribe()
}

#[cfg(test)]
#[path = "edits.test.rs"]
mod tests;
