use crate::error::AppError;
use crate::keychain::OsKeychain;
use crate::sync::account::{AccountServer, Device, SignIn, SignInStarted, SignedInAccount};
use crate::sync::entitlement::{Entitlement, EntitlementStorage};
use crate::sync::http::{client, PRODUCTION_URL};
use crate::sync::keys::SyncKeysStorage;
use crate::sync::state::SyncStateStorage;
use crate::time::now_epoch_ms;
use tauri::State;

/// What this device last heard about the account's Premium, as of now.
#[tauri::command(async)]
pub fn get_entitlement(entitlement: State<'_, EntitlementStorage>) -> Entitlement {
    entitlement.entitlement(now_epoch_ms())
}

/// Who this device is signed in as, or `null` when signed out.
#[tauri::command(async)]
pub fn get_account(
    entitlement: State<'_, EntitlementStorage>,
    state: State<'_, SyncStateStorage>,
    keys: State<'_, SyncKeysStorage>,
) -> Result<Option<SignedInAccount>, AppError> {
    Device { keychain: &OsKeychain, entitlement: &entitlement, state: &state, keys: &keys }.account()
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
    keys: State<'_, SyncKeysStorage>,
) -> Result<SignIn, AppError> {
    let device = Device { keychain: &OsKeychain, entitlement: &entitlement, state: &state, keys: &keys };
    device.finish_sign_in(&server()?, &request, now_epoch_ms()).await
}

#[tauri::command]
pub async fn sign_out(
    entitlement: State<'_, EntitlementStorage>,
    state: State<'_, SyncStateStorage>,
    keys: State<'_, SyncKeysStorage>,
) -> Result<(), AppError> {
    let device = Device { keychain: &OsKeychain, entitlement: &entitlement, state: &state, keys: &keys };
    device.sign_out(&server()?).await
}

/// Deletes the account on the server and forgets it on this device.
#[tauri::command]
pub async fn delete_account(
    entitlement: State<'_, EntitlementStorage>,
    state: State<'_, SyncStateStorage>,
    keys: State<'_, SyncKeysStorage>,
) -> Result<(), AppError> {
    let device = Device { keychain: &OsKeychain, entitlement: &entitlement, state: &state, keys: &keys };
    device.delete_account(&server()?).await
}

fn server() -> Result<AccountServer, AppError> {
    Ok(AccountServer::new(client()?, PRODUCTION_URL))
}
