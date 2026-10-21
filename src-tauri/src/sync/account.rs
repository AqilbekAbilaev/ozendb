//! Signing in to the OzenDB server. The app asks for a sign-in by email, the user approves
//! it from the emailed link on any device, and the app picks up a session it keeps in the
//! OS keychain, never in a file. `GET /me` then tells the entitlement cache about Premium.
use crate::error::AppError;
use crate::keychain::Keychain;
use crate::sync::entitlement::{Account, EntitlementStorage};
use crate::sync::http::{bearer, unreachable};
use crate::sync::state::SyncStateStorage;
use reqwest::header::AUTHORIZATION;
use reqwest::{RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use zeroize::Zeroizing;

pub const SESSION_KEY: &str = "account::session";

/// The server's answer to a sign-in request: `request` picks up the session, and `code`
/// is shown so the user can check it against the emailed page before approving.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub struct SignInStarted {
    pub request: String,
    pub code: String,
}

/// Sent to the frontend as `{ "state": "waiting" }` or `{ "state": "signed_in" }`.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SignIn {
    /// Nobody has approved the request yet.
    Waiting,
    SignedIn,
}

#[derive(Deserialize)]
struct PickedUp {
    session: String,
}

/// The server's sign-in and account calls.
pub struct AccountServer {
    client: reqwest::Client,
    url: String,
}

impl AccountServer {
    pub fn new(client: reqwest::Client, base_url: &str) -> Self {
        Self { client, url: base_url.to_string() }
    }

    /// Asks the server to email a sign-in link to `email`.
    pub async fn start(&self, email: &str) -> Result<SignInStarted, AppError> {
        let response = self.send(self.client.post(format!("{}/auth/email", self.url)).json(&json!({ "email": email }))).await?;
        match response.status() {
            StatusCode::OK => self.parse(response).await,
            StatusCode::BAD_REQUEST => Err(AppError::Validation(format!("\"{email}\" is not a valid email address."))),
            status => Err(AppError::AccountServer(status.as_u16())),
        }
    }

    /// The session, once someone approved `request`; `None` while nobody has.
    pub async fn pickup(&self, request: &str) -> Result<Option<Zeroizing<String>>, AppError> {
        let response = self.send(self.client.post(format!("{}/auth/pickup", self.url)).json(&json!({ "request": request }))).await?;
        match response.status() {
            StatusCode::OK => Ok(Some(Zeroizing::new(self.parse::<PickedUp>(response).await?.session))),
            StatusCode::ACCEPTED => Ok(None),
            StatusCode::UNAUTHORIZED => Err(AppError::SignInExpired),
            status => Err(AppError::AccountServer(status.as_u16())),
        }
    }

    /// Who `session` belongs to, and whether they have Premium.
    pub async fn me(&self, session: &str) -> Result<Account, AppError> {
        let response = self.send(self.client.get(format!("{}/me", self.url)).header(AUTHORIZATION, bearer(session)?)).await?;
        match response.status() {
            StatusCode::OK => self.parse(response).await,
            StatusCode::UNAUTHORIZED => Err(AppError::SignedOut),
            status => Err(AppError::AccountServer(status.as_u16())),
        }
    }

    /// Ends `session` on the server.
    pub async fn sign_out(&self, session: &str) -> Result<(), AppError> {
        let response = self.send(self.client.post(format!("{}/auth/sign-out", self.url)).header(AUTHORIZATION, bearer(session)?)).await?;
        match response.status() {
            status if status.is_success() => Ok(()),
            StatusCode::UNAUTHORIZED => Err(AppError::SignedOut),
            status => Err(AppError::AccountServer(status.as_u16())),
        }
    }

    async fn send(&self, request: RequestBuilder) -> Result<Response, AppError> {
        let response = request.send().await.map_err(|e| unreachable(&e, &self.url))?;
        match response.status() {
            StatusCode::TOO_MANY_REQUESTS => Err(AppError::AccountRateLimited),
            _ => Ok(response),
        }
    }

    // A success whose body isn't the expected answer is the server misbehaving.
    async fn parse<T: DeserializeOwned>(&self, response: Response) -> Result<T, AppError> {
        let status = response.status().as_u16();
        let body = response.bytes().await.map_err(|e| unreachable(&e, &self.url))?;
        serde_json::from_slice(&body).map_err(|_| AppError::AccountServer(status))
    }
}

/// What this device keeps about the signed-in account: the session in the keychain, and
/// in files the Premium answer and what it knows of that account's sync data.
pub struct Device<'a, K: Keychain> {
    pub keychain: &'a K,
    pub entitlement: &'a EntitlementStorage,
    pub state: &'a SyncStateStorage,
}

impl<K: Keychain> Device<'_, K> {
    /// The session sync calls the server with; `None` when signed out.
    pub fn session(&self) -> Result<Option<Zeroizing<String>>, AppError> {
        self.keychain.read(SESSION_KEY)
    }

    /// Picks up the session for `request` once approved, keeps it and records Premium.
    pub async fn finish_sign_in(&self, server: &AccountServer, request: &str, now: i64) -> Result<SignIn, AppError> {
        let Some(session) = server.pickup(request).await? else {
            return Ok(SignIn::Waiting);
        };
        // What is kept may belong to another account. Its sync version could match one
        // of this account's, and the next upload would then overwrite this account's data.
        self.forget()?;
        self.keychain.write(SESSION_KEY, &session)?;
        // Signed in even if `/me` fails: Premium stays unknown until the next refresh.
        match self.record_account(server, &session, now).await {
            Err(AppError::SignedOut) => Err(AppError::SignedOut),
            _ => Ok(SignIn::SignedIn),
        }
    }

    /// Asks the server about Premium again and records its answer.
    pub async fn refresh_account(&self, server: &AccountServer, now: i64) -> Result<(), AppError> {
        let session = self.session()?.ok_or(AppError::SignedOut)?;
        self.record_account(server, &session, now).await
    }

    /// Signs out on this device, and on the server when it can be reached.
    pub async fn sign_out(&self, server: &AccountServer) -> Result<(), AppError> {
        // Forgotten whatever the keychain or the server answer: once this device no longer
        // holds the session it cannot be used, and the server drops it after 90 unused days.
        let session = self.session().ok().flatten();
        self.forget()?;
        if let Some(session) = session {
            let _ = server.sign_out(&session).await;
        }
        Ok(())
    }

    /// Drops the session and everything this device learned with it, as after the
    /// server answers that the session is gone.
    pub fn forget(&self) -> Result<(), AppError> {
        let removed = self.keychain.remove(SESSION_KEY);
        self.entitlement.clear()?;
        self.state.clear()?;
        removed
    }

    async fn record_account(&self, server: &AccountServer, session: &str, now: i64) -> Result<(), AppError> {
        match server.me(session).await {
            Ok(account) => self.entitlement.record(account, now),
            Err(AppError::SignedOut) => {
                self.forget()?;
                Err(AppError::SignedOut)
            }
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
#[path = "account.test.rs"]
mod tests;
