use super::*;
use crate::sync::fake_server::FakeServer;
use crate::sync::http::{client, HttpServer};
use crate::sync::test_server::{received, reply, serving};

/// What another device left on the server: its blob and wrapped keys, as base64.
fn held(recovery_wrapped_key: Option<&str>) -> Contents {
    Contents {
        blob: "YmxvYiDDqQ==".to_string(),
        wrapped_key: "d3JhcHBlZCDDqQ==".to_string(),
        recovery_wrapped_key: recovery_wrapped_key.map(String::from),
    }
}

#[tokio::test]
async fn an_empty_server_makes_this_the_accounts_first_device() {
    assert_eq!(server_status(&FakeServer::default()).await.unwrap(), SetupStatus::New);
}

#[tokio::test]
async fn a_server_holding_data_asks_to_unlock_it_and_says_a_recovery_key_can() {
    let server = FakeServer::default();
    server.store(held(Some("cmVjb3Zlcnkgw6k=")));

    assert_eq!(server_status(&server).await.unwrap(), SetupStatus::Existing { recovery: true });
}

#[tokio::test]
async fn a_server_holding_no_recovery_copy_says_a_recovery_key_cannot_unlock_it() {
    let server = FakeServer::default();
    server.store(held(None));

    assert_eq!(server_status(&server).await.unwrap(), SetupStatus::Existing { recovery: false });
}

#[tokio::test]
async fn a_wrapped_key_that_is_not_base64_is_unreadable() {
    let server = FakeServer::default();
    server.store(Contents { wrapped_key: "not base64 ü".to_string(), ..held(None) });

    assert!(matches!(server_status(&server).await, Err(AppError::UnreadableSyncData)));
}

#[tokio::test]
async fn the_status_downloads_the_whole_copy_over_https() {
    let body = serde_json::to_string(&held(Some("cmVjb3Zlcnkgw6k="))).unwrap();
    let (url, requests) = serving(vec![reply("404 Not Found", "", ""), reply("200 OK", "etag: \"7\"\r\n", &body)]).await;
    let server = HttpServer::new(client().unwrap(), &url, "s3ss.ion-t0ken".to_string());

    assert_eq!(server_status(&server).await.unwrap(), SetupStatus::New);
    assert_eq!(server_status(&server).await.unwrap(), SetupStatus::Existing { recovery: true });
    let requests = received(requests).await;
    assert!(requests.iter().all(|r| r.starts_with("get /sync") && !r.contains("if-none-match")), "{requests:?}");
}
