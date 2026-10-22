use crate::error::AppError;
use crate::sync::account::{AccountServer, SignIn, SignInStarted, SignedInAccount};
use crate::sync::entitlement::{Entitlement, EntitlementStorage};
use crate::sync::http::{client, PRODUCTION_URL};
use crate::sync::run::AppSync;
use crate::time::now_epoch_ms;
use tauri::{AppHandle, State};

/// What this device last heard about the account's Premium, as of now.
#[tauri::command(async)]
pub fn get_entitlement(entitlement: State<'_, EntitlementStorage>) -> Entitlement {
    entitlement.entitlement(now_epoch_ms())
}

/// Who this device is signed in as, or `null` when signed out.
#[tauri::command(async)]
pub fn get_account(app: AppHandle) -> Result<Option<SignedInAccount>, AppError> {
    AppSync(app).device().account()
}

/// Emails a sign-in link to `email`, and returns the request to poll and the code to show.
#[tauri::command]
pub async fn start_sign_in(email: String) -> Result<SignInStarted, AppError> {
    server()?.start(&email).await
}

/// Whether someone approved `request` yet; once they have, this device is signed in.
#[tauri::command]
pub async fn poll_sign_in(app: AppHandle, request: String) -> Result<SignIn, AppError> {
    AppSync(app).device().finish_sign_in(&server()?, &request, now_epoch_ms()).await
}

#[tauri::command]
pub async fn sign_out(app: AppHandle) -> Result<(), AppError> {
    AppSync(app).device().sign_out(&server()?).await
}

/// Deletes the account on the server and forgets it on this device.
#[tauri::command]
pub async fn delete_account(app: AppHandle) -> Result<(), AppError> {
    AppSync(app).device().delete_account(&server()?).await
}

fn server() -> Result<AccountServer, AppError> {
    Ok(AccountServer::new(client()?, PRODUCTION_URL))
}
