//! The sync server over HTTPS: `GET /sync` downloads the encrypted copy, `PUT /sync`
//! replaces it. Versions travel as ETags and are kept exactly as the server sends them,
//! so they go back unchanged in If-None-Match and If-Match.
use crate::error::AppError;
use crate::sync::pass::{Download, SyncServer};
use crate::sync::state::{Contents, ServerCopy};
use reqwest::header::{HeaderValue, AUTHORIZATION, ETAG, IF_MATCH, IF_NONE_MATCH};
use reqwest::{RequestBuilder, Response, StatusCode};
use serde::Deserialize;
use std::time::Duration;

pub const PRODUCTION_URL: &str = "https://api.ozendb.com";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
// For the whole request, so a stalled transfer fails too. An upload can be about 2.5 MB.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// The HTTPS client the sync server is reached with.
pub fn client() -> Result<reqwest::Client, AppError> {
    // `rustls-no-provider` leaves the crypto provider to the app, and reqwest panics
    // without one. It is process-wide, and the updater installs ring the same way, so
    // whichever comes first wins and the other's "already installed" is ignored.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| AppError::Io(std::io::Error::other(e)))
}

/// The sync server at `base_url`, called as the user whose session this is.
pub struct HttpServer {
    client: reqwest::Client,
    url: String,
    session: String,
}

/// What the server answers to an upload, besides the ETag.
#[derive(Deserialize)]
struct Stored {
    version: u64,
}

impl HttpServer {
    pub fn new(client: reqwest::Client, base_url: &str, session: String) -> Self {
        Self { client, url: format!("{base_url}/sync"), session }
    }

    // Sends `request` with the session, and turns the answers either call can get into
    // errors.
    async fn send(&self, request: RequestBuilder) -> Result<Response, AppError> {
        // A session that can't be a header value can't be a live one either.
        let mut session = HeaderValue::try_from(format!("Bearer {}", self.session)).map_err(|_| AppError::SignedOut)?;
        session.set_sensitive(true);
        let response = request.header(AUTHORIZATION, session).send().await.map_err(|e| self.unreachable(&e))?;
        match response.status() {
            StatusCode::UNAUTHORIZED => Err(AppError::SignedOut),
            StatusCode::PAYMENT_REQUIRED => Err(AppError::NotPremium),
            StatusCode::PAYLOAD_TOO_LARGE => Err(AppError::SyncDataTooLarge),
            StatusCode::TOO_MANY_REQUESTS => Err(AppError::SyncRateLimited),
            _ => Ok(response),
        }
    }

    // The answer's body. Failing to read it is the connection failing; whether it parses
    // is the caller's question.
    async fn body(&self, response: Response) -> Result<Vec<u8>, AppError> {
        Ok(response.bytes().await.map_err(|e| self.unreachable(&e))?.to_vec())
    }

    fn unreachable(&self, error: &reqwest::Error) -> AppError {
        let reason = if error.is_timeout() {
            "timed out"
        } else if error.is_connect() {
            "could not connect"
        } else {
            "the connection failed"
        };
        AppError::Unreachable {
            address: error.url().and_then(|url| url.host_str()).unwrap_or(&self.url).to_string(),
            reason: reason.to_string(),
        }
    }
}

impl SyncServer for HttpServer {
    async fn download(&self, known: Option<&str>) -> Result<Download, AppError> {
        let request = match known {
            Some(version) => self.client.get(&self.url).header(IF_NONE_MATCH, version),
            None => self.client.get(&self.url),
        };
        let response = self.send(request).await?;
        match response.status() {
            StatusCode::OK => {
                let version = etag(&response).ok_or(AppError::UnreadableSyncData)?;
                let contents = serde_json::from_slice(&self.body(response).await?).map_err(|_| AppError::UnreadableSyncData)?;
                Ok(Download::Copy(ServerCopy { version, contents }))
            }
            StatusCode::NOT_MODIFIED => Ok(Download::Unchanged),
            StatusCode::NOT_FOUND => Ok(Download::Nothing),
            status => Err(AppError::SyncServer(status.as_u16())),
        }
    }

    async fn upload(&self, replacing: Option<&str>, contents: &Contents) -> Result<Option<String>, AppError> {
        let request = match replacing {
            Some(version) => self.client.put(&self.url).header(IF_MATCH, version),
            // The server refuses an upload that names no version unless it says it is the first.
            None => self.client.put(&self.url).header(IF_NONE_MATCH, "*"),
        };
        let response = self.send(request.json(contents)).await?;
        match response.status() {
            StatusCode::OK => match etag(&response) {
                Some(version) => Ok(Some(version)),
                // Written as the ETag would be, since that is how the next call names it.
                None => {
                    let stored: Stored = serde_json::from_slice(&self.body(response).await?).map_err(|_| AppError::UnreadableSyncData)?;
                    Ok(Some(format!("\"{}\"", stored.version)))
                }
            },
            StatusCode::PRECONDITION_FAILED => Ok(None),
            status => Err(AppError::SyncServer(status.as_u16())),
        }
    }
}

fn etag(response: &Response) -> Option<String> {
    response.headers().get(ETAG).and_then(|value| value.to_str().ok()).map(String::from)
}

#[cfg(test)]
#[path = "http.test.rs"]
mod tests;
