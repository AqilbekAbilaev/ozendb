//! When a sync runs, as decided on 2026-10-18 (#321): when the app starts, 5 minutes after
//! the last edit, before the app quits, and on "Sync now". There is no periodic sync. In
//! place of a signal that the connection is back, which neither Tauri nor the OS crates
//! we have offer, a sync that could not reach the server is tried again after a growing
//! wait, and only while edits made here are still unsent.
//!
//! One task runs every sync itself, so two never overlap, and the triggers that arrive
//! during one lead to a single sync after it. What a sync does is the `Job`'s business,
//! and where its result goes is the `Report`'s; both are traits so this can be tested
//! with paused time and a fake.
use crate::error::AppError;
use std::future::Future;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{sleep_until, timeout, Instant};

pub const EDIT_WAIT: Duration = Duration::from_secs(5 * 60);
/// The server's limits count per minute, so a short hold is enough.
pub const RATE_LIMIT_HOLD: Duration = Duration::from_secs(2 * 60);
/// The longest quitting waits for a last sync.
pub const CLOSE_WAIT: Duration = Duration::from_secs(5);

/// How a sync that ran went.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Ran {
    Synced,
    /// The server refused the upload, as it does once Premium lapses: what came down
    /// was saved, but this device's edits stay here.
    ReceivedOnly,
}

/// One sync, and what it needs first.
pub trait Job: Send + 'static {
    /// Runs once, when the app starts, before the first sync.
    fn prepare(&self) -> impl Future<Output = ()> + Send;
    /// Why no sync can run now (signed out, no Premium, not set up), if none can.
    fn ready(&self) -> Result<(), AppError>;
    fn run(&self) -> impl Future<Output = Result<Ran, AppError>> + Send;
}

/// Where the syncs' progress goes.
pub trait Report: Send + 'static {
    fn started(&self);
    fn finished(&self, result: &Result<Ran, AppError>);
}

enum Trigger {
    Start,
    Now,
    Close(oneshot::Sender<()>),
}

/// The handle the app holds: it asks for syncs, and the schedule decides when they run.
#[derive(Clone)]
pub struct SyncLoop {
    triggers: mpsc::UnboundedSender<Trigger>,
}

/// The handle, and the schedule that the caller spawns on its runtime. `edits` wakes on
/// every edit to synced data (edits.rs).
pub fn sync_loop(job: impl Job, report: impl Report, edits: watch::Receiver<u64>) -> (SyncLoop, impl Future<Output = ()> + Send) {
    let (triggers, received) = mpsc::unbounded_channel();
    let schedule = Schedule { job, report, edits, plan: Plan::default() };
    (SyncLoop { triggers }, schedule.run(received))
}

impl SyncLoop {
    pub fn start(&self) {
        self.send(Trigger::Start);
    }

    pub fn sync_now(&self) {
        self.send(Trigger::Now);
    }

    /// Sends unsent edits before the app quits, waiting at most `CLOSE_WAIT`.
    pub async fn close(&self) {
        let (done, finished) = oneshot::channel();
        self.send(Trigger::Close(done));
        let _ = timeout(CLOSE_WAIT, finished).await;
    }

    // Fails only once the schedule has stopped, when there is nobody left to ask.
    fn send(&self, trigger: Trigger) {
        let _ = self.triggers.send(trigger);
    }
}

struct Schedule<J, R> {
    job: J,
    report: R,
    edits: watch::Receiver<u64>,
    plan: Plan,
}

/// What the schedule has decided so far.
#[derive(Default)]
struct Plan {
    /// When the wait after the last edit ends.
    edit_at: Option<Instant>,
    /// When a sync that could not reach the server is tried again, and how many times
    /// it has been.
    retry_at: Option<Instant>,
    retries: usize,
    /// Until when the server asked for no more syncs.
    held_until: Option<Instant>,
    /// The edit count as of the start of the last sync that sent everything.
    sent: u64,
    /// False once the server refuses uploads or the data's format: only a start or
    /// "Sync now" runs a sync then, since anything else would fail the same way.
    off: bool,
}

impl<J: Job, R: Report> Schedule<J, R> {
    async fn run(mut self, mut triggers: mpsc::UnboundedReceiver<Trigger>) {
        let mut edits_open = true;
        loop {
            let due = self.due();
            tokio::select! {
                trigger = triggers.recv() => {
                    let Some(first) = trigger else { return };
                    let mut batch = vec![first];
                    while let Ok(more) = triggers.try_recv() {
                        batch.push(more);
                    }
                    self.answer(batch).await;
                }
                changed = self.edits.changed(), if edits_open => {
                    edits_open = changed.is_ok();
                    if edits_open && !self.plan.off {
                        self.plan.edit_at = Some(Instant::now() + EDIT_WAIT);
                    }
                }
                () = until(due) => {
                    self.plan.edit_at = None;
                    self.plan.retry_at = None;
                    self.sync(false).await;
                }
            }
        }
    }

    // Every trigger that arrived while the last sync ran is answered by one sync.
    async fn answer(&mut self, batch: Vec<Trigger>) {
        let starting = batch.iter().any(|t| matches!(t, Trigger::Start));
        let asked = batch.iter().any(|t| matches!(t, Trigger::Now));
        if starting {
            self.job.prepare().await;
        }
        if starting || asked {
            self.sync(asked).await;
        } else if !self.plan.off && self.unsent() {
            self.sync(false).await;
        }
        for trigger in batch {
            if let Trigger::Close(done) = trigger {
                let _ = done.send(());
            }
        }
    }

    // `asked`: the user asked for this sync, so a reason it can't run is reported too.
    async fn sync(&mut self, asked: bool) {
        if self.plan.held_until.is_some_and(|until| Instant::now() < until) {
            if asked {
                self.report.finished(&Err(AppError::SyncRateLimited));
            }
            return;
        }
        if let Err(e) = self.job.ready() {
            if asked {
                self.report.finished(&Err(e));
            }
            return;
        }
        // The edits made so far go up with this sync, so they wake nobody afterwards.
        let edits = *self.edits.borrow_and_update();
        self.report.started();
        let result = self.job.run().await;
        self.plan_after(&result, edits);
        self.report.finished(&result);
    }

    fn plan_after(&mut self, result: &Result<Ran, AppError>, edits: u64) {
        let latest = *self.edits.borrow();
        let plan = &mut self.plan;
        let unsent = latest > plan.sent;
        match result {
            // An edit made during the sync has not woken the schedule yet, and starts
            // its own wait once it does.
            Ok(Ran::Synced) => *plan = Plan { sent: edits, ..Plan::default() },
            Ok(Ran::ReceivedOnly) | Err(AppError::NotPremium | AppError::NewerSyncFormat) => {
                *plan = Plan { sent: plan.sent, off: true, ..Plan::default() };
            }
            Err(AppError::SyncRateLimited) => {
                let until = Instant::now() + RATE_LIMIT_HOLD;
                plan.held_until = Some(until);
                if !plan.off && unsent {
                    plan.retry_at = Some(until);
                }
            }
            Err(e) if unreachable(e) => {
                if !plan.off && unsent {
                    plan.retry_at = Some(Instant::now() + retry_wait(plan.retries));
                    plan.retries += 1;
                }
            }
            Err(_) => {}
        }
    }

    // The next time a sync is due by itself, put off past any hold.
    fn due(&self) -> Option<Instant> {
        let at = [self.plan.edit_at, self.plan.retry_at].into_iter().flatten().min()?;
        Some(self.plan.held_until.map_or(at, |until| at.max(until)))
    }

    fn unsent(&self) -> bool {
        *self.edits.borrow() > self.plan.sent
    }
}

/// How long to wait before retry number `retries` (from 0) of a sync that could not
/// reach the server: 1, 2, 4, 8 and 16 minutes, then every 30.
pub fn retry_wait(retries: usize) -> Duration {
    let minutes = [1, 2, 4, 8, 16].get(retries).copied().unwrap_or(30);
    Duration::from_secs(minutes * 60)
}

// The server could not be reached, or failed on its side: worth trying again later.
fn unreachable(error: &AppError) -> bool {
    match error {
        AppError::Unreachable { .. } => true,
        AppError::SyncServer(status) => *status >= 500,
        _ => false,
    }
}

async fn until(at: Option<Instant>) {
    match at {
        Some(at) => sleep_until(at).await,
        None => std::future::pending().await,
    }
}

#[cfg(test)]
#[path = "schedule.test.rs"]
mod tests;
