// Saved, parameterised invocations of an existing operation ("Tasks"), runnable
// on demand or on a schedule. This module owns the persisted model (task
// definitions + a per-task run log) plus the pure schedule-math used by both the
// manual-run path and the in-app scheduler. The run engine itself (which resolves
// managed state and calls the operation commands) lives in `commands/tasks.rs`.

use crate::commands::masking::MaskRule;
use crate::error::AppError;
use crate::json_store::JsonStore;
use chrono::{Datelike, Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// Keep only the most recent runs per task so the run log can't grow unbounded
// (mirrors history.rs's MAX_HISTORY).

// The type-specific payload of a task: exactly the parameters the backing
// operation command needs. Internally tagged (`{ "kind": "export", ... }`) so it
// round-trips cleanly and matches the existing enum style (ConnectionKind).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind")]
pub enum TaskSpec {
    #[serde(rename = "export")]
    Export {
        database: String,
        collection: String,
        path: String,
        format: String,
    },
    #[serde(rename = "import")]
    Import {
        database: String,
        collection: String,
        path: String,
        format: String,
    },
    #[serde(rename = "masking")]
    Masking {
        database: String,
        collection: String,
        filter: String,
        rules: Vec<MaskRule>,
        path: String,
        format: String,
        limit: Option<i64>,
    },
    #[serde(rename = "shell")]
    Shell {
        database: String,
        code: String,
    },
}

// When a task runs itself. `kind` is "interval" | "daily" | "weekly"; only the
// fields that kind needs are populated (cron expressions are deferred to a later
// version, so there is no free-form expression here).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Schedule {
    pub kind: String,
    // interval: minutes between runs.
    #[serde(default)]
    pub every_minutes: Option<i64>,
    // daily/weekly: local wall-clock time of day, "HH:MM".
    #[serde(default)]
    pub at_hhmm: Option<String>,
    // weekly: day of week, 0 = Sunday .. 6 = Saturday.
    #[serde(default)]
    pub weekday: Option<u32>,
}

// A saved task. Timestamps are epoch-ms as strings (same shape as history.rs's
// `now_ms`), converted to local time only for daily/weekly schedule math.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TaskDef {
    pub id: String,
    pub name: String,
    pub connection_id: String,
    pub spec: TaskSpec,
    #[serde(default)]
    pub schedule: Option<Schedule>,
    pub created_at: String,
    #[serde(default)]
    pub last_run: Option<String>,
    #[serde(default)]
    pub last_status: Option<String>,
}

// One entry in a task's run log. `status` is "ok" | "error".
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TaskRun {
    pub ran_at: String,
    pub status: String,
    pub message: String,
}

// The task definitions store (a flat Vec, newest-first for display; mirrors
// saved_queries.rs).
pub struct TaskStore {
    inner: JsonStore<Vec<TaskDef>>,
}

impl TaskStore {
    pub fn new(path: PathBuf) -> Self {
        Self { inner: JsonStore::new(path) }
    }

    pub fn load(&self) -> Vec<TaskDef> {
        self.inner.load()
    }

    pub fn find(&self, id: &str) -> Option<TaskDef> {
        let tasks = self.inner.load();
        for task in tasks.into_iter() {
            if task.id == id {
                return Some(task);
            }
        }
        None
    }

    // Create-or-update by id: replace an existing task in place (keeping its list
    // position) or insert a new one at the front.
    pub fn upsert(&self, task: TaskDef) -> Result<(), AppError> {
        self.inner.update(|tasks| {
            let mut replaced = false;
            for existing in tasks.iter_mut() {
                if existing.id == task.id {
                    *existing = task.clone();
                    replaced = true;
                    break;
                }
            }
            if !replaced {
                tasks.insert(0, task);
            }
        })
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        self.inner.update(|tasks| tasks.retain(|task| task.id != id))
    }

    // Record the outcome of a run against the task's `last_run`/`last_status`.
    pub fn record_run(&self, id: &str, ran_at: &str, status: &str) -> Result<(), AppError> {
        self.inner.update(|tasks| {
            for task in tasks.iter_mut() {
                if task.id == id {
                    task.last_run = Some(ran_at.to_string());
                    task.last_status = Some(status.to_string());
                    break;
                }
            }
        })
    }
}


// ── Schedule math (pure, unit-tested) ─────────────────────────────────────
//
// Both the scheduler tick and the launch catch-up decide "should this run now?"
// via `is_due`, which is defined purely in terms of `next_due_ms`. Keeping the
// math pure (epoch-ms in, epoch-ms out) makes it testable without a clock or a
// running app; `Local` is only consulted to resolve "at HH:MM" against the user's
// timezone for daily/weekly schedules.

// The next time (epoch-ms) this schedule should fire strictly after `baseline_ms`
// (the last run, or the creation time if it has never run). Returns `None` for a
// malformed schedule (missing fields), so a broken task simply never fires rather
// than firing constantly.
pub fn next_due_ms(schedule: &Schedule, baseline_ms: i64) -> Option<i64> {
    match schedule.kind.as_str() {
        "interval" => match schedule.every_minutes {
            Some(minutes) if minutes > 0 => Some(baseline_ms + minutes * 60_000),
            _ => None,
        },
        "daily" => {
            let (hour, minute) = match parse_hhmm(&schedule.at_hhmm) {
                Some(value) => value,
                None => return None,
            };
            next_daily_ms(baseline_ms, hour, minute)
        }
        "weekly" => {
            let (hour, minute) = match parse_hhmm(&schedule.at_hhmm) {
                Some(value) => value,
                None => return None,
            };
            let weekday = match schedule.weekday {
                Some(value) if value <= 6 => value,
                _ => return None,
            };
            next_weekly_ms(baseline_ms, weekday, hour, minute)
        }
        _ => None,
    }
}

// True when the schedule's next-due time is at or before `now_ms`. `last_run` is
// the task's last run (epoch-ms string) if any; otherwise the baseline is the
// creation time, so a freshly-created past-due task catches up on launch.
pub fn is_due(
    schedule: &Schedule,
    last_run: Option<&str>,
    created_at_ms: i64,
    now: i64,
) -> bool {
    let baseline = match last_run {
        Some(value) => match value.parse::<i64>() {
            Ok(parsed) => parsed,
            Err(_) => created_at_ms,
        },
        None => created_at_ms,
    };
    match next_due_ms(schedule, baseline) {
        Some(due) => due <= now,
        None => false,
    }
}

// Parse "HH:MM" into (hour, minute), rejecting out-of-range values.
fn parse_hhmm(at_hhmm: &Option<String>) -> Option<(u32, u32)> {
    let text = match at_hhmm {
        Some(value) => value,
        None => return None,
    };
    let mut parts = text.split(':');
    let hour_str = match parts.next() {
        Some(value) => value,
        None => return None,
    };
    let minute_str = match parts.next() {
        Some(value) => value,
        None => return None,
    };
    if parts.next().is_some() {
        return None;
    }
    let hour = match hour_str.trim().parse::<u32>() {
        Ok(value) if value <= 23 => value,
        _ => return None,
    };
    let minute = match minute_str.trim().parse::<u32>() {
        Ok(value) if value <= 59 => value,
        _ => return None,
    };
    Some((hour, minute))
}

// The first local `hour:minute` strictly after `baseline_ms`, as epoch-ms.
fn next_daily_ms(baseline_ms: i64, hour: u32, minute: u32) -> Option<i64> {
    let baseline = match Local.timestamp_millis_opt(baseline_ms).single() {
        Some(value) => value,
        None => return None,
    };
    // Today at HH:MM; if that is not strictly after the baseline, roll to
    // tomorrow. A DST-skipped local time yields `None`, in which case we fall
    // forward a day rather than fail outright.
    for add_days in 0..=1 {
        let day = baseline.date_naive() + chrono::Duration::days(add_days);
        if let Some(candidate) = local_datetime_ms(day, hour, minute) {
            if candidate > baseline_ms {
                return Some(candidate);
            }
        }
    }
    None
}

// The first local `weekday` at `hour:minute` strictly after `baseline_ms`.
fn next_weekly_ms(baseline_ms: i64, weekday: u32, hour: u32, minute: u32) -> Option<i64> {
    let baseline = match Local.timestamp_millis_opt(baseline_ms).single() {
        Some(value) => value,
        None => return None,
    };
    // Scan the next 8 days so we always find the target weekday even when today
    // already is it but the time has passed.
    for add_days in 0..=7 {
        let day = baseline.date_naive() + chrono::Duration::days(add_days);
        // chrono's Weekday: Mon=0..Sun=6; our stored value is Sun=0..Sat=6.
        let day_weekday = day.weekday().num_days_from_sunday();
        if day_weekday != weekday {
            continue;
        }
        if let Some(candidate) = local_datetime_ms(day, hour, minute) {
            if candidate > baseline_ms {
                return Some(candidate);
            }
        }
    }
    None
}

// Resolve a local calendar day + time to epoch-ms, if that wall-clock exists
// (a DST spring-forward gap makes some times non-existent).
fn local_datetime_ms(day: chrono::NaiveDate, hour: u32, minute: u32) -> Option<i64> {
    let naive_time = match chrono::NaiveTime::from_hms_opt(hour, minute, 0) {
        Some(value) => value,
        None => return None,
    };
    let naive = day.and_time(naive_time);
    match Local.from_local_datetime(&naive).single() {
        Some(value) => Some(value.timestamp_millis()),
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // `.hour()` / `.minute()` on the computed due times are only needed by the
    // assertions here, so the trait is scoped to the tests.
    use chrono::Timelike;
    use tempfile::tempdir;

    fn export_spec() -> TaskSpec {
        TaskSpec::Export {
            database: String::from("db"),
            collection: String::from("coll"),
            path: String::from("/tmp/out.json"),
            format: String::from("json"),
        }
    }

    fn sample_task(id: &str) -> TaskDef {
        TaskDef {
            id: String::from(id),
            name: String::from("Nightly export"),
            connection_id: String::from("conn-1"),
            spec: export_spec(),
            schedule: None,
            created_at: String::from("1000"),
            last_run: None,
            last_status: None,
        }
    }

    #[test]
    fn task_store_upsert_find_and_delete_roundtrip() {
        let dir = tempdir().unwrap();
        let store = TaskStore::new(dir.path().join("tasks.json"));

        store.upsert(sample_task("a")).unwrap();
        store.upsert(sample_task("b")).unwrap();
        assert_eq!(store.load().len(), 2);

        // Upsert with an existing id updates in place (still 2 tasks).
        let mut updated = sample_task("a");
        updated.name = String::from("Renamed");
        store.upsert(updated).unwrap();
        let found = store.find("a").unwrap();
        assert_eq!(found.name, "Renamed");
        assert_eq!(store.load().len(), 2);

        store.delete("a").unwrap();
        assert!(store.find("a").is_none());
        assert_eq!(store.load().len(), 1);
    }

    #[test]
    fn task_store_records_run_outcome() {
        let dir = tempdir().unwrap();
        let store = TaskStore::new(dir.path().join("tasks.json"));
        store.upsert(sample_task("a")).unwrap();
        store.record_run("a", "1234", "ok").unwrap();
        let task = store.find("a").unwrap();
        assert_eq!(task.last_run.as_deref(), Some("1234"));
        assert_eq!(task.last_status.as_deref(), Some("ok"));
    }


    #[test]
    fn interval_next_due_adds_minutes() {
        let schedule = Schedule {
            kind: String::from("interval"),
            every_minutes: Some(5),
            at_hhmm: None,
            weekday: None,
        };
        assert_eq!(next_due_ms(&schedule, 1_000), Some(1_000 + 5 * 60_000));
    }

    #[test]
    fn interval_without_minutes_never_fires() {
        let schedule = Schedule {
            kind: String::from("interval"),
            every_minutes: None,
            at_hhmm: None,
            weekday: None,
        };
        assert_eq!(next_due_ms(&schedule, 1_000), None);
    }

    #[test]
    fn daily_next_due_is_after_baseline_and_at_the_time() {
        // Pick a concrete local moment: baseline at 08:00 local, schedule at 09:00.
        let baseline = Local
            .with_ymd_and_hms(2026, 7, 8, 8, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let schedule = Schedule {
            kind: String::from("daily"),
            every_minutes: None,
            at_hhmm: Some(String::from("09:00")),
            weekday: None,
        };
        let due = next_due_ms(&schedule, baseline).unwrap();
        let due_local = Local.timestamp_millis_opt(due).single().unwrap();
        assert!(due > baseline);
        assert_eq!(due_local.hour(), 9);
        assert_eq!(due_local.minute(), 0);
        // Same calendar day (09:00 is still ahead of 08:00).
        assert_eq!(due_local.date_naive(), due_local.date_naive());
    }

    #[test]
    fn daily_rolls_to_tomorrow_when_time_already_passed() {
        // Baseline at 10:00 local, schedule at 09:00 -> next is tomorrow 09:00.
        let baseline_dt = Local.with_ymd_and_hms(2026, 7, 8, 10, 0, 0).single().unwrap();
        let baseline = baseline_dt.timestamp_millis();
        let schedule = Schedule {
            kind: String::from("daily"),
            every_minutes: None,
            at_hhmm: Some(String::from("09:00")),
            weekday: None,
        };
        let due = next_due_ms(&schedule, baseline).unwrap();
        let due_local = Local.timestamp_millis_opt(due).single().unwrap();
        assert_eq!(due_local.hour(), 9);
        assert_eq!(
            due_local.date_naive(),
            baseline_dt.date_naive() + chrono::Duration::days(1)
        );
    }

    #[test]
    fn weekly_next_due_lands_on_requested_weekday() {
        // 2026-07-08 is a Wednesday. Ask for Friday (num_days_from_sunday = 5).
        let baseline = Local
            .with_ymd_and_hms(2026, 7, 8, 8, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let schedule = Schedule {
            kind: String::from("weekly"),
            every_minutes: None,
            at_hhmm: Some(String::from("09:00")),
            weekday: Some(5),
        };
        let due = next_due_ms(&schedule, baseline).unwrap();
        let due_local = Local.timestamp_millis_opt(due).single().unwrap();
        assert_eq!(due_local.weekday().num_days_from_sunday(), 5);
        assert_eq!(due_local.hour(), 9);
        assert!(due > baseline);
    }

    #[test]
    fn is_due_true_when_next_due_in_past() {
        let schedule = Schedule {
            kind: String::from("interval"),
            every_minutes: Some(1),
            at_hhmm: None,
            weekday: None,
        };
        // Never run; created at t=0; now is well past one minute -> due (catch-up).
        assert!(is_due(&schedule, None, 0, 10 * 60_000));
    }

    #[test]
    fn is_due_false_before_next_due() {
        let schedule = Schedule {
            kind: String::from("interval"),
            every_minutes: Some(10),
            at_hhmm: None,
            weekday: None,
        };
        // Last run at t=0, now is only 1 minute later -> not yet due.
        assert!(!is_due(&schedule, Some("0"), 0, 60_000));
    }

    #[test]
    fn is_due_uses_created_at_when_never_run() {
        let schedule = Schedule {
            kind: String::from("interval"),
            every_minutes: Some(5),
            at_hhmm: None,
            weekday: None,
        };
        // Created at t=1000, now is 1000 + 4min -> next due at 1000 + 5min, not yet.
        assert!(!is_due(&schedule, None, 1_000, 1_000 + 4 * 60_000));
    }
}
