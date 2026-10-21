use crate::error::AppError;
use crate::keychain::OsKeychain;
use crate::sync::account::Device;
use crate::sync::crypto::INTERACTIVE;
use crate::sync::http::{client, HttpServer, PRODUCTION_URL};
use crate::sync::pass::Local;
use crate::sync::run::AppSync;
use crate::sync::schedule::SyncLoop;
use crate::sync::setup::{create, first_upload, server_status, PendingSetup, SetupStatus};
use crate::time::now_epoch_ms;
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

/// Whether sync is set up here, and if not, whether this is the account's first device.
#[tauri::command]
pub async fn sync_setup_status(app: AppHandle) -> Result<SetupStatus, AppError> {
    let sync = AppSync(app);
    let device = sync.device();
    if device.keys.keys(&OsKeychain)?.is_some() {
        return Ok(SetupStatus::SetUp);
    }
    server_status(&server(&device)?).await
}

/// The first step on an account's first device: makes keys wrapped by `password` and
/// holds them, and returns the recovery key to show the user once.
#[tauri::command]
pub async fn create_sync_keys(app: AppHandle, pending: State<'_, PendingSetup>, password: String) -> Result<String, AppError> {
    let password = Zeroizing::new(password);
    let session = AppSync(app).device().session()?.ok_or(AppError::SignedOut)?;
    // Argon2id takes most of a second, too long to hold up an async worker.
    let (keys, recovery) = tokio::task::spawn_blocking(move || create(&password, &INTERACTIVE))
        .await
        .map_err(|e| AppError::Crypto(format!("Making the sync keys failed: {e}.")))??;
    pending.hold(session, keys);
    Ok(recovery.to_string())
}

/// The last step on an account's first device, once the recovery key is saved: uploads
/// this device's data with the held keys, and only then keeps them. On failure the keys
/// stay held, so trying again shows no new recovery key.
#[tauri::command]
pub async fn finish_sync_setup(app: AppHandle, pending: State<'_, PendingSetup>) -> Result<(), AppError> {
    let sync = AppSync(app.clone());
    let device = sync.device();
    let session = device.session()?.ok_or(AppError::SignedOut)?;
    let keys = pending.take(&session).ok_or(AppError::SyncNotSetUp)?;
    let server = HttpServer::new(client()?, PRODUCTION_URL, session.to_string());
    let stores = sync.stores();
    let local = Local { stores: &stores, keychain: &OsKeychain, state: device.state };
    let result = first_upload(&local, &server, &keys, now_epoch_ms()).await;
    sync.settle(&result).await;
    match result {
        Ok(_) => {
            device.keys.save(&OsKeychain, &keys)?;
            // Refreshes the sync status, which still says sync is not set up.
            app.state::<SyncLoop>().sync_now();
            Ok(())
        }
        Err(AppError::SyncSetUpElsewhere) => Err(AppError::SyncSetUpElsewhere),
        Err(error) => {
            pending.hold(session, keys);
            Err(error)
        }
    }
}

// The sync server, called as the signed-in account.
fn server(device: &Device<'_, OsKeychain>) -> Result<HttpServer, AppError> {
    let session = device.session()?.ok_or(AppError::SignedOut)?;
    Ok(HttpServer::new(client()?, PRODUCTION_URL, session.to_string()))
}
