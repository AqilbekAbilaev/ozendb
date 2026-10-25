use super::Run;
use crate::error::AppError;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{oneshot, Notify};
use tokio::task::JoinHandle;

const PID: i32 = 7;

/// A statement running under `run` until `stop` is notified, once it has started.
async fn statement(run: &Arc<Run>, stop: &Arc<Notify>) -> JoinHandle<Result<(), AppError>> {
    let (started, started_rx) = oneshot::channel();
    let (run, stop) = (run.clone(), stop.clone());
    let running = tokio::spawn(async move {
        run.on(async {
            started.send(()).unwrap();
            stop.notified().await;
            Ok(())
        })
        .await
    });
    started_rx.await.unwrap();
    running
}

#[tokio::test]
async fn a_cancel_before_the_statement_starts_stops_it_from_starting() {
    let run = Run::new("before", PID);
    let signalled = &Mutex::new(Vec::new());
    run.cancel(|pid| async move { signalled.lock().unwrap().push(pid); Ok(()) }).await.unwrap();

    let outcome = run.on(async { panic!("the statement ran") }).await;
    assert!(matches!(outcome, Err::<(), _>(AppError::Cancelled)));
    assert!(signalled.lock().unwrap().is_empty(), "an idle process isn't signalled");
}

#[tokio::test]
async fn a_cancel_during_the_statement_signals_its_process() {
    let (run, stop) = (Arc::new(Run::new("during", PID)), Arc::new(Notify::new()));
    let running = statement(&run, &stop).await;

    let (signalled, stop) = (&Mutex::new(Vec::new()), &stop);
    run.cancel(|pid| async move { signalled.lock().unwrap().push(pid); stop.notify_one(); Ok(()) }).await.unwrap();
    assert_eq!(*signalled.lock().unwrap(), vec![PID]);
    running.await.unwrap().unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_signal_that_reaches_the_process_before_its_statement_is_sent_again() {
    let (run, stop) = (Arc::new(Run::new("early", PID)), Arc::new(Notify::new()));
    let running = statement(&run, &stop).await;

    // The first signal finds the process still idle, and is lost; the second stops it.
    let (signals, stop) = (&Mutex::new(0), &stop);
    run.cancel(|_| async move {
        let mut signals = signals.lock().unwrap();
        *signals += 1;
        if *signals == 2 {
            stop.notify_one();
        }
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(*signals.lock().unwrap(), 2);
    running.await.unwrap().unwrap();
}

#[tokio::test]
async fn a_statement_does_not_end_while_a_signal_for_it_is_on_its_way() {
    let (run, stop) = (Arc::new(Run::new("ending", PID)), Arc::new(Notify::new()));
    let running = statement(&run, &stop).await;

    let (signalling, signalling_rx) = oneshot::channel::<()>();
    let (release, release_rx) = oneshot::channel::<()>();
    let cancelling = {
        let run = run.clone();
        let slot = Mutex::new(Some((signalling, release_rx)));
        tokio::spawn(async move {
            let slot = &slot;
            run.cancel(|_| async move {
                let (signalling, release_rx) = slot.lock().unwrap().take().unwrap();
                signalling.send(()).unwrap();
                release_rx.await.unwrap();
                Ok(())
            })
            .await
        })
    };
    signalling_rx.await.unwrap();
    // The statement finishes on the server while its signal is still on the way.
    stop.notify_one();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!running.is_finished(), "it hands its connection on only once the signal has arrived");

    release.send(()).unwrap();
    running.await.unwrap().unwrap();
    cancelling.await.unwrap().unwrap();
}
