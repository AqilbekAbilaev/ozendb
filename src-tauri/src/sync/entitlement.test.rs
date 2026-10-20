use super::{Account, Entitlement, EntitlementStorage, Subscription, CLOCK_DRIFT_MS, GRACE_MS};
use tempfile::tempdir;

const RECEIVED_AT: i64 = 1_760_000_000_000;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

fn account(premium: bool, subscription: Option<Subscription>) -> Account {
    Account { email: String::from("zoë.o'brien+sync@exämple.com"), premium, subscription }
}

fn subscription(status: &str, ends_at: Option<i64>) -> Subscription {
    Subscription { status: status.to_string(), renews_at: None, ends_at }
}

fn store() -> (tempfile::TempDir, EntitlementStorage) {
    let dir = tempdir().unwrap();
    let store = EntitlementStorage::new(dir.path().join("entitlement.json"));
    (dir, store)
}

fn recorded(account: Account) -> (tempfile::TempDir, EntitlementStorage) {
    let (dir, store) = store();
    store.record(account, RECEIVED_AT).unwrap();
    (dir, store)
}

#[test]
fn a_fresh_premium_answer_grants_premium_for_the_grace_period() {
    let (_dir, store) = recorded(account(true, Some(subscription("active", None))));
    assert_eq!(store.entitlement(RECEIVED_AT), Entitlement::Premium { until: RECEIVED_AT + GRACE_MS });
}

#[test]
fn the_grace_period_is_seven_days() {
    assert_eq!(GRACE_MS, 7 * DAY_MS);
}

#[test]
fn premium_holds_just_inside_seven_days_after_the_answer() {
    let (_dir, store) = recorded(account(true, None));
    assert!(store.entitlement(RECEIVED_AT + GRACE_MS - 1).has_premium());
}

#[test]
fn premium_expires_seven_days_after_the_answer() {
    let (_dir, store) = recorded(account(true, None));
    assert_eq!(store.entitlement(RECEIVED_AT + GRACE_MS), Entitlement::Expired);
}

#[test]
fn a_cancelled_subscription_stops_premium_at_its_end_inside_the_grace_period() {
    let ends_at = RECEIVED_AT + 2 * DAY_MS;
    let (_dir, store) = recorded(account(true, Some(subscription("cancelled", Some(ends_at)))));
    assert_eq!(store.entitlement(ends_at - 1), Entitlement::Premium { until: ends_at });
    assert_eq!(store.entitlement(ends_at), Entitlement::Expired);
}

#[test]
fn a_subscription_ending_after_the_grace_period_still_stops_at_seven_days() {
    let ends_at = RECEIVED_AT + 30 * DAY_MS;
    let (_dir, store) = recorded(account(true, Some(subscription("cancelled", Some(ends_at)))));
    assert_eq!(store.entitlement(RECEIVED_AT), Entitlement::Premium { until: RECEIVED_AT + GRACE_MS });
}

#[test]
fn an_answer_without_premium_grants_none() {
    let (_dir, store) = recorded(account(false, Some(subscription("expired", Some(RECEIVED_AT - DAY_MS)))));
    assert_eq!(store.entitlement(RECEIVED_AT), Entitlement::Free);
}

#[test]
fn a_newer_answer_replaces_the_older_one() {
    let (_dir, store) = recorded(account(true, None));
    store.record(account(false, None), RECEIVED_AT + DAY_MS).unwrap();
    assert_eq!(store.entitlement(RECEIVED_AT + DAY_MS), Entitlement::Free);
}

#[test]
fn no_recorded_answer_means_the_entitlement_is_unknown() {
    let (_dir, store) = store();
    assert_eq!(store.entitlement(RECEIVED_AT), Entitlement::Unknown);
}

#[test]
fn the_tolerated_clock_drift_is_five_minutes() {
    assert_eq!(CLOCK_DRIFT_MS, 5 * 60 * 1000);
}

#[test]
fn a_clock_just_inside_the_drift_behind_the_answer_keeps_premium_to_the_same_end() {
    let (_dir, store) = recorded(account(true, None));
    assert_eq!(store.entitlement(RECEIVED_AT - CLOCK_DRIFT_MS), Entitlement::Premium { until: RECEIVED_AT + GRACE_MS });
}

#[test]
fn a_clock_further_behind_the_answer_than_the_drift_grants_no_premium() {
    let (_dir, store) = recorded(account(true, None));
    assert_eq!(store.entitlement(RECEIVED_AT - CLOCK_DRIFT_MS - 1), Entitlement::Expired);
}

#[test]
fn clearing_forgets_the_answer() {
    let (_dir, store) = recorded(account(true, None));
    store.clear().unwrap();
    assert_eq!(store.entitlement(RECEIVED_AT), Entitlement::Unknown);
}

#[test]
fn a_file_in_an_older_format_loads_as_no_answer() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("entitlement.json");
    std::fs::write(&path, r#"{ "premium": true, "checked": "yesterday" }"#).unwrap();
    assert_eq!(EntitlementStorage::new(path).entitlement(RECEIVED_AT), Entitlement::Unknown);
}

#[test]
fn the_server_answer_reads_straight_from_the_me_response() {
    let body = r#"{ "email": "a@b.c", "premium": true, "subscription": { "status": "cancelled", "renews_at": null, "ends_at": 1760000000000 } }"#;
    let account: Account = serde_json::from_str(body).unwrap();
    assert_eq!(
        account,
        Account { email: String::from("a@b.c"), premium: true, subscription: Some(subscription("cancelled", Some(RECEIVED_AT))) },
    );
}

#[test]
fn the_frontend_tells_each_entitlement_apart_by_its_state() {
    let json = |entitlement: Entitlement| serde_json::to_value(entitlement).unwrap();
    assert_eq!(json(Entitlement::Unknown), serde_json::json!({ "state": "unknown" }));
    assert_eq!(json(Entitlement::Free), serde_json::json!({ "state": "free" }));
    assert_eq!(json(Entitlement::Premium { until: RECEIVED_AT }), serde_json::json!({ "state": "premium", "until": RECEIVED_AT }));
    assert_eq!(json(Entitlement::Expired), serde_json::json!({ "state": "expired" }));
}
