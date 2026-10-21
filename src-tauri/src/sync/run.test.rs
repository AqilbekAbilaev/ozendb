use super::*;
use serde_json::json;

const NOW: i64 = 1_760_000_000_000;

#[test]
fn a_signed_in_premium_device_that_is_set_up_can_sync() {
    assert!(readiness(true, Entitlement::Premium { until: NOW + 1 }, true).is_ok());
}

#[test]
fn a_lapsed_subscription_can_still_sync() {
    assert!(readiness(true, Entitlement::Expired, true).is_ok());
}

#[test]
fn a_signed_out_device_cannot_sync() {
    assert!(matches!(readiness(false, Entitlement::Premium { until: NOW + 1 }, true), Err(AppError::SignedOut)));
}

#[test]
fn a_free_account_cannot_sync() {
    assert!(matches!(readiness(true, Entitlement::Free, true), Err(AppError::NotPremium)));
}

#[test]
fn an_account_the_server_never_described_cannot_sync() {
    assert!(matches!(readiness(true, Entitlement::Unknown, true), Err(AppError::NotPremium)));
}

#[test]
fn a_device_without_sync_keys_cannot_sync() {
    assert!(matches!(readiness(true, Entitlement::Premium { until: NOW + 1 }, false), Err(AppError::SyncNotSetUp)));
}

#[test]
fn a_running_sync_is_sent_as_running() {
    let sent = serde_json::to_value(SyncStatus::running(NOW, None)).unwrap();
    assert_eq!(sent, json!({ "status": "running", "error": null, "received_only": false, "keychain_error": null, "time": NOW, "last_synced": null }));
}

#[test]
fn a_sync_whose_secret_the_keychain_refused_is_synced_with_the_keychain_error() {
    let synced = Synced { keychain_error: Some(AppError::Keychain("access denied".into())), ..Synced::default() };
    let sent = serde_json::to_value(SyncStatus::finished(&Ok(synced), NOW, Some(NOW))).unwrap();
    assert_eq!(sent["status"], "synced");
    assert_eq!(sent["keychain_error"], json!({ "code": "keychain", "message": "Keychain error: access denied" }));
}

#[test]
fn a_sync_the_server_only_let_download_is_synced_and_received_only() {
    let synced = Synced { received_only: true, ..Synced::default() };
    let sent = serde_json::to_value(SyncStatus::finished(&Ok(synced), NOW, Some(NOW))).unwrap();
    assert_eq!((sent["status"].clone(), sent["received_only"].clone()), (json!("synced"), json!(true)));
}

#[test]
fn a_failed_sync_is_sent_with_its_error() {
    let failed = Err(AppError::Unreachable { address: "api.ozendb.test".into(), reason: "could not connect".into() });
    let sent = serde_json::to_value(SyncStatus::finished(&failed, NOW, Some(NOW - 7_200_000))).unwrap();
    assert_eq!(sent["status"], "failed");
    assert_eq!(sent["error"]["code"], "unreachable");
    assert_eq!(sent["time"], NOW);
}

#[test]
fn a_failed_sync_still_says_when_this_device_last_synced() {
    let failed = Err(AppError::Unreachable { address: "api.ozendb.test".into(), reason: "could not connect".into() });
    let sent = serde_json::to_value(SyncStatus::finished(&failed, NOW, Some(NOW - 7_200_000))).unwrap();
    assert_eq!(sent["last_synced"], NOW - 7_200_000);
}

#[test]
fn the_latest_status_is_kept() {
    let last = LastSync::default();
    last.keep(SyncStatus::running(NOW, None));
    last.keep(SyncStatus::finished(&Ok(Synced::default()), NOW + 1, Some(NOW + 1)));
    assert_eq!(last.status(), Some(SyncStatus::finished(&Ok(Synced::default()), NOW + 1, Some(NOW + 1))));
}
