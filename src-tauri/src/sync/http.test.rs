use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio::time::timeout;

const SESSION: &str = "s3ss.ion_with-dots~and/slashes+=";
const WAIT: Duration = Duration::from_secs(5);

/// A server on a local port that gives one fixed answer, and the request it answered,
/// its head lowercased so header names compare however the client spells them.
async fn answering(response: String) -> (HttpServer, JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let request = tokio::spawn(async move {
        let (mut stream, _) = timeout(WAIT, listener.accept()).await.unwrap().unwrap();
        let mut read = Vec::new();
        let mut buffer = [0u8; 4096];
        let request = loop {
            let n = timeout(WAIT, stream.read(&mut buffer)).await.unwrap().unwrap();
            read.extend_from_slice(&buffer[..n]);
            let text = String::from_utf8_lossy(&read).to_string();
            if let Some(end) = text.find("\r\n\r\n") {
                let head = text[..end].to_lowercase();
                let length = head
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .map_or(0, |n| n.trim().parse().unwrap());
                if read.len() >= end + 4 + length {
                    break format!("{head}\r\n\r\n{}", &text[end + 4..]);
                }
            }
            assert!(n > 0, "the client closed before sending its whole request");
        };
        timeout(WAIT, stream.write_all(response.as_bytes())).await.unwrap().unwrap();
        request
    });
    (HttpServer::new(client().unwrap(), &base_url, SESSION.to_string()), request)
}

fn reply(status: &str, headers: &str, body: &str) -> String {
    format!("HTTP/1.1 {status}\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n{body}", body.len())
}

async fn sent(request: JoinHandle<String>) -> String {
    timeout(WAIT, request).await.unwrap().unwrap()
}

fn contents(recovery_wrapped_key: Option<&str>) -> Contents {
    Contents {
        blob: "YmxvYiB3aXRoIGFjY2VudHMgw6k=".to_string(),
        wrapped_key: "a2V5Lw==".to_string(),
        recovery_wrapped_key: recovery_wrapped_key.map(String::from),
    }
}

#[tokio::test]
async fn a_download_naming_no_version_sends_the_session_and_reads_the_copy_and_its_etag() {
    let body = r#"{"blob":"YmxvYiB3aXRoIGFjY2VudHMgw6k=","wrapped_key":"a2V5Lw==","recovery_wrapped_key":null}"#;
    let (server, request) = answering(reply("200 OK", "etag: \"42\"\r\ncontent-type: application/json\r\n", body)).await;

    let answer = server.download(None).await.unwrap();

    let request = sent(request).await;
    assert!(request.starts_with("get /sync "));
    assert!(request.contains(&format!("authorization: bearer {}", SESSION.to_lowercase())));
    assert!(!request.contains("if-none-match"));
    match answer {
        Download::Copy(copy) => assert_eq!(copy, ServerCopy { version: "\"42\"".to_string(), contents: contents(None) }),
        _ => panic!("expected the server's copy"),
    }
}

#[tokio::test]
async fn a_download_naming_a_version_sends_it_and_reads_not_modified_as_unchanged() {
    let (server, request) = answering(reply("304 Not Modified", "etag: \"42\"\r\n", "")).await;

    let answer = server.download(Some("\"42\"")).await.unwrap();

    assert!(sent(request).await.contains("if-none-match: \"42\""));
    assert!(matches!(answer, Download::Unchanged));
}

#[tokio::test]
async fn a_download_with_nothing_stored_is_nothing() {
    let (server, _request) = answering(reply("404 Not Found", "", "")).await;

    assert!(matches!(server.download(None).await.unwrap(), Download::Nothing));
}

#[tokio::test]
async fn a_download_without_an_etag_is_unreadable() {
    let body = r#"{"blob":"YmxvYg==","wrapped_key":"a2V5","recovery_wrapped_key":null}"#;
    let (server, _request) = answering(reply("200 OK", "", body)).await;

    assert!(matches!(server.download(None).await, Err(AppError::UnreadableSyncData)));
}

#[tokio::test]
async fn a_download_whose_body_is_not_the_contents_is_unreadable() {
    let (server, _request) = answering(reply("200 OK", "etag: \"3\"\r\n", "<html>maintenance</html>")).await;

    assert!(matches!(server.download(None).await, Err(AppError::UnreadableSyncData)));
}

#[tokio::test]
async fn a_first_upload_says_so_sends_a_missing_recovery_key_as_null_and_returns_the_etag() {
    let (server, request) = answering(reply("200 OK", "etag: \"1\"\r\n", r#"{"version":1}"#)).await;

    let version = server.upload(None, &contents(None)).await.unwrap();

    let request = sent(request).await;
    assert!(request.starts_with("put /sync "));
    assert!(request.contains("if-none-match: *"));
    assert!(!request.contains("if-match"));
    let body: serde_json::Value = serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(body, serde_json::json!({ "blob": "YmxvYiB3aXRoIGFjY2VudHMgw6k=", "wrapped_key": "a2V5Lw==", "recovery_wrapped_key": null }));
    assert_eq!(version.as_deref(), Some("\"1\""));
}

#[tokio::test]
async fn a_replacing_upload_names_the_version_it_replaces() {
    let (server, request) = answering(reply("200 OK", "etag: \"8\"\r\n", r#"{"version":8}"#)).await;

    let version = server.upload(Some("\"7\""), &contents(Some("cmVjb3Zlcnk="))).await.unwrap();

    let request = sent(request).await;
    assert!(request.contains("if-match: \"7\""));
    assert!(!request.contains("if-none-match"));
    assert_eq!(version.as_deref(), Some("\"8\""));
}

#[tokio::test]
async fn an_upload_answered_without_an_etag_takes_the_version_from_the_body() {
    let (server, _request) = answering(reply("200 OK", "", r#"{"version":12}"#)).await;

    assert_eq!(server.upload(Some("\"11\""), &contents(None)).await.unwrap().as_deref(), Some("\"12\""));
}

#[tokio::test]
async fn an_upload_another_device_beat_is_none() {
    let (server, _request) = answering(reply("412 Precondition Failed", "", "")).await;

    assert_eq!(server.upload(Some("\"7\""), &contents(None)).await.unwrap(), None);
}

#[tokio::test]
async fn a_gone_session_is_signed_out_on_either_call() {
    let (server, _request) = answering(reply("401 Unauthorized", "", "")).await;
    assert!(matches!(server.download(None).await, Err(AppError::SignedOut)));

    let (server, _request) = answering(reply("401 Unauthorized", "", "")).await;
    assert!(matches!(server.upload(None, &contents(None)).await, Err(AppError::SignedOut)));
}

#[tokio::test]
async fn an_upload_without_premium_is_not_premium() {
    let (server, _request) = answering(reply("402 Payment Required", "", "")).await;

    assert!(matches!(server.upload(Some("\"7\""), &contents(None)).await, Err(AppError::NotPremium)));
}

#[tokio::test]
async fn an_upload_too_large_to_store_is_too_large() {
    let (server, _request) = answering(reply("413 Content Too Large", "", "")).await;

    assert!(matches!(server.upload(Some("\"7\""), &contents(None)).await, Err(AppError::SyncDataTooLarge)));
}

#[tokio::test]
async fn too_many_requests_is_rate_limited() {
    let (server, _request) = answering(reply("429 Too Many Requests", "retry-after: 30\r\n", "")).await;

    assert!(matches!(server.download(Some("\"7\"")).await, Err(AppError::SyncRateLimited)));
}

#[tokio::test]
async fn any_other_answer_is_a_server_error_with_its_status() {
    let (server, _request) = answering(reply("500 Internal Server Error", "", "")).await;
    assert!(matches!(server.download(None).await, Err(AppError::SyncServer(500))));

    let (server, _request) = answering(reply("428 Precondition Required", "", "")).await;
    assert!(matches!(server.upload(None, &contents(None)).await, Err(AppError::SyncServer(428))));
}

#[tokio::test]
async fn a_server_nobody_answers_at_is_unreachable() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let server = HttpServer::new(client().unwrap(), &base_url, SESSION.to_string());

    match timeout(WAIT, server.download(None)).await.unwrap() {
        Err(AppError::Unreachable { address, reason }) => {
            assert_eq!(address, "127.0.0.1");
            assert_eq!(reason, "could not connect");
        }
        _ => panic!("expected the server to be unreachable"),
    }
}
