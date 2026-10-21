//! A server on a local port that gives fixed answers, so the HTTP clients are tested
//! without the network.
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio::time::timeout;

pub const WAIT: Duration = Duration::from_secs(5);

/// Gives each of `responses` in turn, one connection each, and returns the base URL and
/// the requests it answered, their heads lowercased so header names compare however the
/// client spells them.
pub async fn serving(responses: Vec<String>) -> (String, JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let requests = tokio::spawn(async move {
        let mut requests = Vec::new();
        for response in responses {
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
            requests.push(request);
        }
        requests
    });
    (base_url, requests)
}

/// A base URL where nothing listens.
pub async fn nobody_listening() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    format!("http://{}", listener.local_addr().unwrap())
}

pub fn reply(status: &str, headers: &str, body: &str) -> String {
    format!("HTTP/1.1 {status}\r\n{headers}content-length: {}\r\nconnection: close\r\n\r\n{body}", body.len())
}

pub async fn received(requests: JoinHandle<Vec<String>>) -> Vec<String> {
    timeout(WAIT, requests).await.unwrap().unwrap()
}
