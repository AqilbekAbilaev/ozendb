use crate::error::AppError;
use crate::keychain::OsKeychain;
use crate::sync::account::Device;
use crate::sync::http::{client, HttpServer, PRODUCTION_URL};
use crate::sync::run::AppSync;
use crate::sync::setup::{server_status, SetupStatus};
use tauri::AppHandle;

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

// The sync server, called as the signed-in account.
fn server(device: &Device<'_, OsKeychain>) -> Result<HttpServer, AppError> {
    let session = device.session()?.ok_or(AppError::SignedOut)?;
    Ok(HttpServer::new(client()?, PRODUCTION_URL, session.to_string()))
}
