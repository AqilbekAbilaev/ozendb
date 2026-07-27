// Wall-clock helpers. These were copy-pasted into four modules; sharing them keeps
// every persisted timestamp on the same epoch-millisecond basis, which the schedule
// math and the newest-first sorts both depend on.

use std::time::{SystemTime, UNIX_EPOCH};

/// Current wall-clock as epoch milliseconds — the integer form, for comparisons.
pub fn now_epoch_ms() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(_) => 0,
    }
}

/// Current wall-clock as an epoch-millisecond string — the form stored in JSON
/// (`created_at`, `last_run`, `saved_at`, `added`, …).
pub fn now_ms() -> String {
    format!("{}", now_epoch_ms())
}
