//! The sync the schedule runs: this app's stores against the sync server. Its progress
//! goes to the frontend as the `sync-status` event, and the latest is kept for the
//! `sync_status` command, since a start-up sync can finish before the window listens.
use crate::commands::AppContext;
use crate::default_queries::DefaultQueryStorage;
use crate::error::AppError;
use crate::events::SYNC_STATUS;
use crate::folders::FolderStorage;
use crate::keychain::OsKeychain;
use crate::known_hosts::KnownHostsStore;
use crate::node_tags::NodeTagStorage;
use crate::postgres::query_library::PgQueryLibraryStore;
use crate::saved_queries::SavedQueryStorage;
use crate::settings::SettingsStorage;
use crate::sync::account::{AccountServer, Device};
use crate::sync::entitlement::{Entitlement, EntitlementStorage};
use crate::sync::http::{client, HttpServer, PRODUCTION_URL};
use crate::sync::keys::SyncKeysStorage;
use crate::sync::pass::{sync, Local, Synced};
use crate::sync::schedule::{Job, Report};
use crate::sync::snapshot::SyncedStores;
use crate::sync::state::SyncStateStorage;
use crate::time::now_epoch_ms;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// Whether a sync can run: signed in, with Premium or a lapsed subscription (the server
/// still lets those download), and sync set up on this device.
pub fn readiness(signed_in: bool, entitlement: Entitlement, set_up: bool) -> Result<(), AppError> {
    if !signed_in {
        return Err(AppError::SignedOut);
    }
    if !matches!(entitlement, Entitlement::Premium { .. } | Entitlement::Expired) {
        return Err(AppError::NotPremium);
    }
    if !set_up {
        return Err(AppError::SyncNotSetUp);
    }
    Ok(())
}

/// Syncing this app, with the stores and keys it manages.
pub struct AppSync(pub AppHandle);

impl AppSync {
    fn device(&self) -> Device<'_, OsKeychain> {
        Device {
            keychain: &OsKeychain,
            entitlement: self.0.state::<EntitlementStorage>().inner(),
            state: self.0.state::<SyncStateStorage>().inner(),
            keys: self.0.state::<SyncKeysStorage>().inner(),
        }
    }
}

impl Job for AppSync {
    async fn prepare(&self) {
        // Without an answer the last one recorded stands, so a failure is no reason to stop.
        if let Ok(client) = client() {
            let _ = self.device().refresh_account(&AccountServer::new(client, PRODUCTION_URL), now_epoch_ms()).await;
        }
    }

    fn ready(&self) -> Result<(), AppError> {
        let device = self.device();
        let signed_in = device.session()?.is_some();
        readiness(signed_in, device.entitlement.entitlement(now_epoch_ms()), device.keys.keys(&OsKeychain)?.is_some())
    }

    async fn run(&self) -> Result<Synced, AppError> {
        let device = self.device();
        let session = device.session()?.ok_or(AppError::SignedOut)?;
        let keys = device.keys.keys(&OsKeychain)?.ok_or(AppError::SyncNotSetUp)?;
        let server = HttpServer::new(client()?, PRODUCTION_URL, session.to_string());
        let ctx = self.0.state::<AppContext>();
        let stores = SyncedStores {
            connections: &ctx.storage,
            folders: self.0.state::<FolderStorage>().inner(),
            saved_queries: self.0.state::<SavedQueryStorage>().inner(),
            pg_queries: self.0.state::<PgQueryLibraryStore>().inner(),
            default_queries: self.0.state::<DefaultQueryStorage>().inner(),
            node_tags: self.0.state::<NodeTagStorage>().inner(),
            settings: self.0.state::<SettingsStorage>().inner(),
            known_hosts: self.0.state::<Arc<KnownHostsStore>>().inner(),
        };
        let local = Local { stores: &stores, keychain: &OsKeychain, state: device.state };
        let result = sync(&local, &server, &keys.keys(), now_epoch_ms()).await;
        match &result {
            Ok(synced) => {
                for id in &synced.changed_connections {
                    ctx.pool.remove(id).await;
                }
            }
            Err(AppError::SignedOut) => {
                let _ = device.forget();
            }
            Err(_) => {}
        }
        result
    }
}

/// An error as the frontend reads one (src/utils/errors.js).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Problem {
    code: &'static str,
    message: String,
}

impl From<&AppError> for Problem {
    fn from(error: &AppError) -> Self {
        Problem { code: error.code(), message: error.user_message() }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Running,
    Synced,
    Failed,
}

/// What the frontend is told about a sync. `received_only`: the server refused the
/// upload, as it does once Premium lapses, so this device's edits stay here.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SyncStatus {
    status: Stage,
    error: Option<Problem>,
    received_only: bool,
    keychain_error: Option<Problem>,
    /// Epoch milliseconds.
    time: i64,
}

impl SyncStatus {
    pub fn running(time: i64) -> Self {
        SyncStatus { status: Stage::Running, error: None, received_only: false, keychain_error: None, time }
    }

    pub fn finished(result: &Result<Synced, AppError>, time: i64) -> Self {
        match result {
            Ok(synced) => SyncStatus {
                status: Stage::Synced,
                error: None,
                received_only: synced.received_only,
                keychain_error: synced.keychain_error.as_ref().map(Problem::from),
                time,
            },
            Err(e) => SyncStatus { status: Stage::Failed, error: Some(Problem::from(e)), received_only: false, keychain_error: None, time },
        }
    }
}

/// The latest sync status, for a window that opens after it was sent.
#[derive(Default)]
pub struct LastSync(Mutex<Option<SyncStatus>>);

impl LastSync {
    pub fn status(&self) -> Option<SyncStatus> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }

    fn keep(&self, status: SyncStatus) {
        *self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(status);
    }
}

/// Sends each status to the frontend and keeps the latest.
pub struct StatusEvents(pub AppHandle);

impl StatusEvents {
    fn announce(&self, status: SyncStatus) {
        self.0.state::<LastSync>().keep(status.clone());
        let _ = self.0.emit(SYNC_STATUS, status);
    }
}

impl Report for StatusEvents {
    fn started(&self) {
        self.announce(SyncStatus::running(now_epoch_ms()));
    }

    fn finished(&self, result: &Result<Synced, AppError>) {
        self.announce(SyncStatus::finished(result, now_epoch_ms()));
    }
}

#[cfg(test)]
#[path = "run.test.rs"]
mod tests;
