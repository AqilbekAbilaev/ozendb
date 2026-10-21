//! Setting sync up on this device (#326). On an account's first device the user chooses
//! a sync password and is shown a recovery key; on any later one they unlock the key the
//! server already holds with either of them.
use crate::error::AppError;
use crate::sync::pass::{Download, SyncServer};
use crate::sync::state::Contents;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;

/// Sent to the frontend as `{ "state": "set_up" }`, `{ "state": "new" }` or
/// `{ "state": "existing", "recovery": true }`.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SetupStatus {
    /// This device already holds the keys.
    SetUp,
    /// The server holds nothing yet: this is the account's first device.
    New,
    /// Another device set sync up; `recovery` says whether a recovery key can unlock it.
    Existing { recovery: bool },
}

/// The wrapped copies of the data key the server holds.
pub struct ServerKeys {
    wrapped_key: Vec<u8>,
    recovery_wrapped_key: Option<Vec<u8>>,
}

impl ServerKeys {
    /// The server's wrapped keys; `None` when it holds nothing yet.
    pub async fn fetch(server: &impl SyncServer) -> Result<Option<Self>, AppError> {
        match server.download(None).await? {
            Download::Nothing => Ok(None),
            Download::Copy(copy) => Ok(Some(Self::decode(&copy.contents)?)),
            // Named no version, so "not modified" can't be about one this device knows.
            Download::Unchanged => Err(AppError::UnreadableSyncData),
        }
    }

    fn decode(contents: &Contents) -> Result<Self, AppError> {
        let decode = |text: &str| BASE64.decode(text).map_err(|_| AppError::UnreadableSyncData);
        Ok(Self {
            wrapped_key: decode(&contents.wrapped_key)?,
            recovery_wrapped_key: contents.recovery_wrapped_key.as_deref().map(decode).transpose()?,
        })
    }
}

/// How far sync is set up for the account, as the server tells it.
pub async fn server_status(server: &impl SyncServer) -> Result<SetupStatus, AppError> {
    Ok(match ServerKeys::fetch(server).await? {
        None => SetupStatus::New,
        Some(held) => SetupStatus::Existing { recovery: held.recovery_wrapped_key.is_some() },
    })
}

#[cfg(test)]
#[path = "setup.test.rs"]
mod tests;
