use super::*;
use crate::sync::pass::Synced;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tokio::time::sleep;

const MINUTE: Duration = Duration::from_secs(60);

/// What the fake job's next sync answers.
#[derive(Clone, Copy)]
enum Answer {
    Synced,
    ReceivedOnly,
    Unreachable,
    ServerDown,
    RateLimited,
}

impl Answer {
    fn result(self) -> Result<Synced, AppError> {
        match self {
            Answer::Synced => Ok(Synced::default()),
            Answer::ReceivedOnly => Ok(Synced { received_only: true, ..Synced::default() }),
            Answer::Unreachable => Err(AppError::Unreachable { address: "api.ozendb.test".into(), reason: "could not connect".into() }),
            Answer::ServerDown => Err(AppError::SyncServer(503)),
            Answer::RateLimited => Err(AppError::SyncRateLimited),
        }
    }
}

#[derive(Default)]
struct Script {
    /// The answers in turn; once they run out, every sync is synced.
    answers: VecDeque<Answer>,
    /// How long each sync takes.
    takes: Duration,
    signed_out: bool,
    prepared: usize,
    runs: usize,
    running: usize,
    most_at_once: usize,
}

#[derive(Clone, Default)]
struct FakeJob(Arc<Mutex<Script>>);

impl FakeJob {
    fn answering(answers: &[Answer]) -> Self {
        let job = FakeJob::default();
        job.0.lock().unwrap().answers = answers.iter().copied().collect();
        job
    }

    fn runs(&self) -> usize {
        self.0.lock().unwrap().runs
    }
}

impl Job for FakeJob {
    async fn prepare(&self) {
        self.0.lock().unwrap().prepared += 1;
    }

    fn ready(&self) -> Result<(), AppError> {
        if self.0.lock().unwrap().signed_out { Err(AppError::SignedOut) } else { Ok(()) }
    }

    async fn run(&self) -> Result<Synced, AppError> {
        let takes = {
            let mut script = self.0.lock().unwrap();
            script.runs += 1;
            script.running += 1;
            script.most_at_once = script.most_at_once.max(script.running);
            script.takes
        };
        sleep(takes).await;
        let mut script = self.0.lock().unwrap();
        script.running -= 1;
        script.answers.pop_front().unwrap_or(Answer::Synced).result()
    }
}

#[derive(Clone, Default)]
struct FakeReport(Arc<Mutex<Vec<String>>>);

impl FakeReport {
    fn finished(&self) -> Vec<String> {
        self.0.lock().unwrap().iter().filter(|line| *line != "started").cloned().collect()
    }
}

impl Report for FakeReport {
    fn started(&self) {
        self.0.lock().unwrap().push("started".into());
    }

    fn finished(&self, result: &Result<Synced, AppError>) {
        let line = match result {
            Ok(Synced { received_only: true, .. }) => "received_only".to_string(),
            Ok(_) => "synced".to_string(),
            Err(e) => e.code().to_string(),
        };
        self.0.lock().unwrap().push(line);
    }
}

/// A started schedule, with what it runs, where it reports and the edit signal it watches.
struct Running {
    sync: SyncLoop,
    job: FakeJob,
    report: FakeReport,
    edits: watch::Sender<u64>,
}

impl Running {
    fn edit(&self) {
        self.edits.send_modify(|count| *count += 1);
    }
}

// Starts the schedule and lets its start-up sync finish.
async fn started(job: FakeJob) -> Running {
    let (edits, watched) = watch::channel(0);
    let report = FakeReport::default();
    let (sync, schedule) = sync_loop(job.clone(), report.clone(), watched);
    tokio::spawn(schedule);
    sync.start();
    sleep(Duration::from_millis(1)).await;
    Running { sync, job, report, edits }
}

// Lets the schedule act on what was just sent to it.
async fn settle() {
    sleep(Duration::from_millis(1)).await;
}

#[tokio::test(start_paused = true)]
async fn starting_prepares_then_syncs_once() {
    let running = started(FakeJob::default()).await;
    assert_eq!(running.job.0.lock().unwrap().prepared, 1);
    assert_eq!(running.job.runs(), 1);
    assert_eq!(*running.report.0.lock().unwrap(), vec!["started", "synced"]);
}

#[tokio::test(start_paused = true)]
async fn an_edit_syncs_five_minutes_later_and_not_sooner() {
    let running = started(FakeJob::default()).await;
    running.edit();
    sleep(EDIT_WAIT - Duration::from_secs(1)).await;
    assert_eq!(running.job.runs(), 1);
    sleep(Duration::from_secs(2)).await;
    assert_eq!(running.job.runs(), 2);
}

#[tokio::test(start_paused = true)]
async fn another_edit_restarts_the_wait() {
    let running = started(FakeJob::default()).await;
    running.edit();
    sleep(3 * MINUTE).await;
    running.edit();
    sleep(EDIT_WAIT - Duration::from_secs(1)).await;
    assert_eq!(running.job.runs(), 1);
    sleep(Duration::from_secs(2)).await;
    assert_eq!(running.job.runs(), 2);
}

#[tokio::test(start_paused = true)]
async fn after_an_edit_is_sent_nothing_more_runs_by_itself() {
    let running = started(FakeJob::default()).await;
    running.edit();
    sleep(EDIT_WAIT + MINUTE).await;
    sleep(24 * 60 * MINUTE).await;
    assert_eq!(running.job.runs(), 2);
}

#[tokio::test(start_paused = true)]
async fn requests_made_during_a_sync_lead_to_one_more_sync() {
    let job = FakeJob::default();
    job.0.lock().unwrap().takes = Duration::from_secs(10);
    let running = started(job).await;
    for _ in 0..3 {
        running.sync.sync_now();
    }
    sleep(MINUTE).await;
    assert_eq!(running.job.runs(), 2);
}

#[tokio::test(start_paused = true)]
async fn syncs_asked_for_from_several_tasks_at_once_never_overlap() {
    let job = FakeJob::default();
    job.0.lock().unwrap().takes = Duration::from_secs(3);
    let running = started(job).await;
    for _ in 0..5 {
        let sync = running.sync.clone();
        tokio::spawn(async move {
            for _ in 0..4 {
                sync.sync_now();
                sleep(Duration::from_secs(1)).await;
            }
        });
    }
    sleep(10 * MINUTE).await;
    assert!(running.job.runs() > 2);
    assert_eq!(running.job.0.lock().unwrap().most_at_once, 1);
}

#[tokio::test(start_paused = true)]
async fn an_unreachable_server_with_unsent_edits_is_tried_again_after_growing_waits() {
    let running = started(FakeJob::answering(&[Answer::Synced, Answer::Unreachable, Answer::Unreachable, Answer::Unreachable])).await;
    running.edit();
    sleep(EDIT_WAIT + Duration::from_secs(1)).await;
    assert_eq!(running.job.runs(), 2);
    sleep(MINUTE).await;
    assert_eq!(running.job.runs(), 3);
    sleep(MINUTE).await;
    assert_eq!(running.job.runs(), 3);
    sleep(MINUTE).await;
    assert_eq!(running.job.runs(), 4);
}

#[tokio::test(start_paused = true)]
async fn a_failing_server_is_tried_again_like_an_unreachable_one() {
    let running = started(FakeJob::answering(&[Answer::Synced, Answer::ServerDown])).await;
    running.edit();
    sleep(EDIT_WAIT + Duration::from_secs(1)).await;
    sleep(MINUTE).await;
    assert_eq!(running.job.runs(), 3);
}

#[tokio::test(start_paused = true)]
async fn an_unreachable_server_without_unsent_edits_waits_for_the_next_trigger() {
    let running = started(FakeJob::answering(&[Answer::Unreachable])).await;
    sleep(60 * MINUTE).await;
    assert_eq!(running.job.runs(), 1);
}

#[test]
fn retries_wait_one_two_four_eight_and_sixteen_minutes_then_thirty() {
    let waits: Vec<u64> = (0..7).map(|retries| retry_wait(retries).as_secs() / 60).collect();
    assert_eq!(waits, vec![1, 2, 4, 8, 16, 30, 30]);
}

#[tokio::test(start_paused = true)]
async fn a_rate_limited_sync_with_unsent_edits_runs_again_when_the_hold_ends() {
    let running = started(FakeJob::answering(&[Answer::Synced, Answer::RateLimited])).await;
    running.edit();
    sleep(EDIT_WAIT + Duration::from_secs(1)).await;
    sleep(RATE_LIMIT_HOLD - Duration::from_secs(2)).await;
    assert_eq!(running.job.runs(), 2);
    sleep(Duration::from_secs(2)).await;
    assert_eq!(running.job.runs(), 3);
}

#[tokio::test(start_paused = true)]
async fn an_edit_wait_that_ends_during_a_hold_runs_when_the_hold_ends() {
    let running = started(FakeJob::answering(&[Answer::Synced, Answer::RateLimited])).await;
    running.edit();
    sleep(4 * MINUTE).await;
    running.sync.sync_now();
    sleep(MINUTE + Duration::from_secs(1)).await;
    // The edit's wait ended a second ago, inside the hold that lasts a minute more.
    assert_eq!(running.job.runs(), 2);
    sleep(MINUTE).await;
    assert_eq!(running.job.runs(), 3);
}

#[tokio::test(start_paused = true)]
async fn sync_now_during_a_hold_reports_rate_limited_without_syncing() {
    let running = started(FakeJob::answering(&[Answer::RateLimited])).await;
    running.sync.sync_now();
    settle().await;
    assert_eq!(running.job.runs(), 1);
    assert_eq!(running.report.finished(), vec!["sync_rate_limited", "sync_rate_limited"]);
}

#[tokio::test(start_paused = true)]
async fn closing_with_unsent_edits_syncs_first() {
    let running = started(FakeJob::default()).await;
    running.edit();
    running.sync.close().await;
    assert_eq!(running.job.runs(), 2);
}

#[tokio::test(start_paused = true)]
async fn closing_with_nothing_unsent_does_not_sync() {
    let running = started(FakeJob::default()).await;
    running.sync.close().await;
    assert_eq!(running.job.runs(), 1);
}

#[tokio::test(start_paused = true)]
async fn closing_waits_no_longer_than_the_close_wait_for_a_hung_sync() {
    let running = started(FakeJob::default()).await;
    running.job.0.lock().unwrap().takes = 60 * MINUTE;
    running.edit();
    let asked = Instant::now();
    running.sync.close().await;
    assert!(asked.elapsed() >= CLOSE_WAIT && asked.elapsed() < CLOSE_WAIT + Duration::from_secs(1));
}

#[tokio::test(start_paused = true)]
async fn a_lapsed_account_syncs_on_start_and_sync_now_only() {
    let running = started(FakeJob::answering(&[Answer::ReceivedOnly, Answer::ReceivedOnly])).await;
    running.edit();
    sleep(EDIT_WAIT + MINUTE).await;
    running.sync.close().await;
    assert_eq!(running.job.runs(), 1);
    running.sync.sync_now();
    settle().await;
    assert_eq!(running.job.runs(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_lapsed_account_whose_upload_goes_through_again_syncs_on_edits_again() {
    let running = started(FakeJob::answering(&[Answer::ReceivedOnly, Answer::Synced])).await;
    running.sync.sync_now();
    settle().await;
    running.edit();
    sleep(EDIT_WAIT + Duration::from_secs(1)).await;
    assert_eq!(running.job.runs(), 3);
}

#[tokio::test(start_paused = true)]
async fn a_device_that_cannot_sync_says_why_when_the_app_starts() {
    let job = FakeJob::default();
    job.0.lock().unwrap().signed_out = true;
    let running = started(job).await;
    assert_eq!(running.job.runs(), 0);
    assert_eq!(running.report.finished(), vec!["signed_out"]);
}

#[tokio::test(start_paused = true)]
async fn a_device_that_cannot_sync_stays_quiet_after_edits_until_asked() {
    let job = FakeJob::default();
    job.0.lock().unwrap().signed_out = true;
    let running = started(job).await;
    running.edit();
    sleep(EDIT_WAIT + MINUTE).await;
    assert_eq!(running.job.runs(), 0);
    assert_eq!(running.report.finished(), vec!["signed_out"]);
    running.sync.sync_now();
    settle().await;
    assert_eq!(running.report.finished(), vec!["signed_out", "signed_out"]);
}
