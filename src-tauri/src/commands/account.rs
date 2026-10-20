use crate::sync::entitlement::{Entitlement, EntitlementStorage};
use crate::time::now_epoch_ms;
use tauri::State;

/// What this device last heard about the account's Premium, as of now.
#[tauri::command(async)]
pub fn get_entitlement(entitlement: State<'_, EntitlementStorage>) -> Entitlement {
    entitlement.entitlement(now_epoch_ms())
}
