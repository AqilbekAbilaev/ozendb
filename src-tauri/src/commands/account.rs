use crate::error::AppError;
use crate::keychain::OsKeychain;
use crate::sync::account::{AccountServer, Device, SignIn, SignInStarted};
use crate::sync::entitlement::{Entitlement, EntitlementStorage};
use crate::sync::http::{client, PRODUCTION_URL};
use crate::sync::state::SyncStateStorage;
use crate::time::now_epoch_ms;
use tauri::State;

/// What this device last heard about the account's Premium, as of now.
#[tauri::command(async)]
pub fn get_entitlement(entitlement: State<'_, EntitlementStorage>) -> Entitlement {
    entitlement.entitlement(now_epoch_ms())
}

/// Emails a sign-in link to `email`, and returns the request to poll and the code to show.
#[tauri::command]
pub async fn start_sign_in(email: String) -> Result<SignInStarted, AppError> {
    server()?.start(&email).await
}

/// Whether someone approved `request` yet; once they have, this device is signed in.
#[tauri::command]
pub async fn poll_sign_in(
    request: String,
    entitlement: State<'_, EntitlementStorage>,
    state: State<'_, SyncStateStorage>,
) -> Result<SignIn, AppError> {
    let device = Device { keychain: &OsKeychain, entitlement: &entitlement, state: &state };
    device.finish_sign_in(&server()?, &request, now_epoch_ms()).await
}

#[tauri::command]
pub async fn sign_out(entitlement: State<'_, EntitlementStorage>, state: State<'_, SyncStateStorage>) -> Result<(), AppError> {
    let device = Device { keychain: &OsKeychain, entitlement: &entitlement, state: &state };
    device.sign_out(&server()?).await
}

fn server() -> Result<AccountServer, AppError> {
    Ok(AccountServer::new(client()?, PRODUCTION_URL))
}
