use super::*;
use crate::keychain::fake::{FakeKeychain, LockedKeychain};
use crate::sync::entitlement::{Entitlement, GRACE_MS};
use crate::sync::http::client;
use crate::sync::state::{Contents, ServerCopy, SyncState};
use crate::sync::test_server::{nobody_listening, received, reply, serving};
use std::time::Duration;
use tempfile::TempDir;
use tokio::time::timeout;

const NOW: i64 = 1_760_000_000_000;
const EMAIL: &str = "zoë.o'brien+sync@exämple.com";
const REQUEST: &str = "r3qu.est_with-dots~and/slashes";
const SESSION: &str = "s3ss.ion_with-dots~and/slashes+=";
const PREMIUM: &str = r#"{"email":"zoë.o'brien+sync@exämple.com","premium":true,"subscription":{"status":"active","renews_at":1760000000001,"ends_at":null}}"#;

struct Files {
    _dir: TempDir,
    entitlement: EntitlementStorage,
    state: SyncStateStorage,
}

fn files() -> Files {
    let dir = tempfile::tempdir().unwrap();
    let entitlement = EntitlementStorage::new(dir.path().join("entitlement.json"));
    let state = SyncStateStorage::new(dir.path().join("sync state.json"));
    Files { _dir: dir, entitlement, state }
}

/// Files as another account left them: a Premium answer, a kept server copy and a sync time.
fn files_of_another_account() -> Files {
    let files = files();
    let account = Account { email: "ånother@exämple.com".to_string(), premium: true, subscription: None };
    files.entitlement.record(account, NOW - 1).unwrap();
    let contents = Contents { blob: "YmxvYg==".to_string(), wrapped_key: "a2V5".to_string(), recovery_wrapped_key: None };
    let server = ServerCopy { version: "\"3\"".to_string(), contents };
    files.state.inner.save(&SyncState { last_sync: Some(NOW - 1), server: Some(server) }).unwrap();
    files
}

fn device<'a, K: Keychain>(keychain: &'a K, files: &'a Files) -> Device<'a, K> {
    Device { keychain, entitlement: &files.entitlement, state: &files.state }
}

fn signed_in() -> FakeKeychain {
    FakeKeychain::holding(&[(SESSION_KEY, SESSION)])
}

async fn server(responses: Vec<String>) -> (AccountServer, tokio::task::JoinHandle<Vec<String>>) {
    let (base_url, requests) = serving(responses).await;
    (AccountServer::new(client().unwrap(), &base_url), requests)
}

fn body(request: &str) -> serde_json::Value {
    serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap()
}

fn assert_nothing_kept(keychain: &FakeKeychain, files: &Files) {
    assert!(keychain.entries().is_empty());
    assert_eq!(files.entitlement.entitlement(NOW), Entitlement::Unknown);
    let state = files.state.load();
    assert_eq!((state.last_sync, state.server), (None, None));
}

#[tokio::test]
async fn starting_posts_the_email_and_reads_the_request_and_code() {
    let (server, requests) = server(vec![reply("200 OK", "", r#"{"request":"r3qu.est","code":"0042"}"#)]).await;

    let started = server.start(EMAIL).await.unwrap();

    let request = received(requests).await.remove(0);
    assert!(request.starts_with("post /auth/email "));
    assert_eq!(body(&request), json!({ "email": EMAIL }));
    assert_eq!(started, SignInStarted { request: "r3qu.est".to_string(), code: "0042".to_string() });
}

#[tokio::test]
async fn an_email_the_server_refuses_is_a_validation_error_naming_it() {
    let (server, _requests) = server(vec![reply("400 Bad Request", "", "")]).await;

    match server.start("not an address").await {
        Err(AppError::Validation(message)) => assert!(message.contains("\"not an address\"")),
        _ => panic!("expected a validation error"),
    }
}

#[tokio::test]
async fn too_many_sign_in_requests_is_rate_limited() {
    let (server, _requests) = server(vec![reply("429 Too Many Requests", "retry-after: 60\r\n", "")]).await;

    assert!(matches!(server.start(EMAIL).await, Err(AppError::AccountRateLimited)));
}

#[tokio::test]
async fn a_success_whose_body_is_not_the_answer_is_a_server_error() {
    let (server, _requests) = server(vec![reply("200 OK", "", "<html>maintenance</html>")]).await;

    assert!(matches!(server.start(EMAIL).await, Err(AppError::AccountServer(200))));
}

#[tokio::test]
async fn a_request_nobody_approved_yet_is_waiting_and_keeps_nothing() {
    let (server, requests) = server(vec![reply("202 Accepted", "", "")]).await;
    let (keychain, files) = (FakeKeychain::default(), files());

    assert_eq!(device(&keychain, &files).finish_sign_in(&server, REQUEST, NOW).await.unwrap(), SignIn::Waiting);

    let request = received(requests).await.remove(0);
    assert!(request.starts_with("post /auth/pickup "));
    assert_eq!(body(&request), json!({ "request": REQUEST }));
    assert!(keychain.entries().is_empty());
}

#[tokio::test]
async fn an_expired_request_is_sign_in_expired() {
    let (server, _requests) = server(vec![reply("401 Unauthorized", "", "")]).await;
    let (keychain, files) = (FakeKeychain::default(), files());

    let answer = device(&keychain, &files).finish_sign_in(&server, REQUEST, NOW).await;

    assert!(matches!(answer, Err(AppError::SignInExpired)));
}

#[tokio::test]
async fn an_approved_request_keeps_the_session_in_the_keychain_and_records_premium() {
    let picked_up = format!(r#"{{"session":"{SESSION}"}}"#);
    let (server, requests) = server(vec![reply("200 OK", "", &picked_up), reply("200 OK", "", PREMIUM)]).await;
    let (keychain, files) = (FakeKeychain::default(), files());

    assert_eq!(device(&keychain, &files).finish_sign_in(&server, REQUEST, NOW).await.unwrap(), SignIn::SignedIn);

    let requests = received(requests).await;
    assert!(requests[1].starts_with("get /me "));
    assert!(requests[1].contains(&format!("authorization: bearer {}", SESSION.to_lowercase())));
    assert_eq!(keychain.entries().get(SESSION_KEY).map(String::as_str), Some(SESSION));
    assert_eq!(files.entitlement.entitlement(NOW), Entitlement::Premium { until: NOW + GRACE_MS });
}

#[tokio::test]
async fn a_new_sign_in_leaves_nothing_of_the_previous_account_behind() {
    let picked_up = format!(r#"{{"session":"{SESSION}"}}"#);
    let (server, _requests) = server(vec![reply("200 OK", "", &picked_up), reply("500 Internal Server Error", "", "")]).await;
    let (keychain, files) = (FakeKeychain::holding(&[(SESSION_KEY, "öld session")]), files_of_another_account());

    device(&keychain, &files).finish_sign_in(&server, REQUEST, NOW).await.unwrap();

    assert_eq!(keychain.entries().get(SESSION_KEY).map(String::as_str), Some(SESSION));
    assert_eq!(files.entitlement.entitlement(NOW), Entitlement::Unknown);
    let state = files.state.load();
    assert_eq!((state.last_sync, state.server), (None, None));
}

#[tokio::test]
async fn a_failed_premium_check_after_sign_in_still_signs_in_with_premium_unknown() {
    let picked_up = format!(r#"{{"session":"{SESSION}"}}"#);
    let (server, _requests) = server(vec![reply("200 OK", "", &picked_up), reply("503 Service Unavailable", "", "")]).await;
    let (keychain, files) = (FakeKeychain::default(), files());

    assert_eq!(device(&keychain, &files).finish_sign_in(&server, REQUEST, NOW).await.unwrap(), SignIn::SignedIn);

    assert_eq!(keychain.entries().get(SESSION_KEY).map(String::as_str), Some(SESSION));
    assert_eq!(files.entitlement.entitlement(NOW), Entitlement::Unknown);
}

#[tokio::test]
async fn a_keychain_that_cannot_keep_the_session_fails_with_the_keychain_error() {
    let picked_up = format!(r#"{{"session":"{SESSION}"}}"#);
    let (server, _requests) = server(vec![reply("200 OK", "", &picked_up)]).await;
    let files = files_of_another_account();

    let answer = device(&LockedKeychain, &files).finish_sign_in(&server, REQUEST, NOW).await;

    assert!(matches!(answer, Err(AppError::Keychain(_))));
    assert_eq!(files.entitlement.entitlement(NOW), Entitlement::Unknown);
}

#[tokio::test]
async fn refreshing_records_the_servers_answer() {
    let (server, requests) = server(vec![reply("200 OK", "", PREMIUM)]).await;
    let (keychain, files) = (signed_in(), files());

    device(&keychain, &files).refresh_account(&server, NOW).await.unwrap();

    assert!(received(requests).await[0].contains(&format!("authorization: bearer {}", SESSION.to_lowercase())));
    assert_eq!(files.entitlement.entitlement(NOW), Entitlement::Premium { until: NOW + GRACE_MS });
}

#[tokio::test]
async fn a_session_the_server_no_longer_knows_is_forgotten() {
    let (server, _requests) = server(vec![reply("401 Unauthorized", "", "")]).await;
    let (keychain, files) = (signed_in(), files_of_another_account());

    let answer = device(&keychain, &files).refresh_account(&server, NOW).await;

    assert!(matches!(answer, Err(AppError::SignedOut)));
    assert_nothing_kept(&keychain, &files);
}

#[tokio::test]
async fn refreshing_while_signed_out_is_signed_out() {
    let server = AccountServer::new(client().unwrap(), &nobody_listening().await);
    let (keychain, files) = (FakeKeychain::default(), files());

    assert!(matches!(device(&keychain, &files).refresh_account(&server, NOW).await, Err(AppError::SignedOut)));
}

#[tokio::test]
async fn signing_out_ends_the_session_on_the_server_and_forgets_it_here() {
    let (server, requests) = server(vec![reply("204 No Content", "", "")]).await;
    let (keychain, files) = (signed_in(), files_of_another_account());

    device(&keychain, &files).sign_out(&server).await.unwrap();

    let request = received(requests).await.remove(0);
    assert!(request.starts_with("post /auth/sign-out "));
    assert!(request.contains(&format!("authorization: bearer {}", SESSION.to_lowercase())));
    assert_nothing_kept(&keychain, &files);
}

#[tokio::test]
async fn signing_out_offline_still_forgets_the_session_here() {
    let server = AccountServer::new(client().unwrap(), &nobody_listening().await);
    let (keychain, files) = (signed_in(), files_of_another_account());

    device(&keychain, &files).sign_out(&server).await.unwrap();

    assert_nothing_kept(&keychain, &files);
}

#[tokio::test]
async fn signing_out_without_a_session_asks_nothing_of_the_server() {
    let (server, requests) = server(vec![reply("204 No Content", "", "")]).await;
    let (keychain, files) = (FakeKeychain::default(), files_of_another_account());

    device(&keychain, &files).sign_out(&server).await.unwrap();

    assert!(timeout(Duration::from_millis(200), requests).await.is_err(), "expected no request");
    assert_nothing_kept(&keychain, &files);
}

#[test]
fn a_device_without_a_session_has_no_account() {
    let (keychain, files) = (FakeKeychain::default(), files());
    assert_eq!(device(&keychain, &files).account().unwrap(), None);
}

#[test]
fn a_signed_in_device_reports_the_email_and_subscription_the_server_last_gave() {
    let (keychain, files) = (signed_in(), files());
    files.entitlement.record(serde_json::from_str(PREMIUM).unwrap(), NOW).unwrap();

    let subscription = Subscription { status: "active".to_string(), renews_at: Some(NOW + 1), ends_at: None };
    assert_eq!(
        device(&keychain, &files).account().unwrap(),
        Some(SignedInAccount { email: Some(EMAIL.to_string()), subscription: Some(subscription) }),
    );
}

#[test]
fn a_device_signed_in_before_the_server_described_the_account_is_signed_in_without_details() {
    let (keychain, files) = (signed_in(), files());
    assert_eq!(device(&keychain, &files).account().unwrap(), Some(SignedInAccount { email: None, subscription: None }));
}

#[test]
fn a_keychain_that_cannot_be_read_fails_with_the_keychain_error() {
    let files = files();
    assert!(matches!(device(&LockedKeychain, &files).account(), Err(AppError::Keychain(_))));
}

#[test]
fn the_frontend_reads_the_account_as_email_and_subscription() {
    let subscription = Subscription { status: "cancelled".to_string(), renews_at: None, ends_at: Some(NOW) };
    let account = SignedInAccount { email: Some(EMAIL.to_string()), subscription: Some(subscription) };
    assert_eq!(
        serde_json::to_value(account).unwrap(),
        serde_json::json!({ "email": EMAIL, "subscription": { "status": "cancelled", "renews_at": null, "ends_at": NOW } }),
    );
}
