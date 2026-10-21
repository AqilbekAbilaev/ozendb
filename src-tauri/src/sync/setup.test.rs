use super::*;
use crate::sync::fake_server::FakeServer;
use crate::sync::http::{client, HttpServer};
use crate::sync::test_device::{folder, Device};
use crate::sync::test_server::{received, reply, serving};

const NOW: i64 = 1_000_000_000_000;
const PASSWORD: &str = "correct horse/battery.staple — ünïcödé";

fn cheap() -> Params {
    Params::new(64, 1, 1, None).unwrap()
}

fn new_keys() -> SyncKeys {
    create(PASSWORD, &cheap()).unwrap().0
}

async fn upload_from(device: &Device, server: &FakeServer<'_>, keys: &SyncKeys) -> Result<Synced, AppError> {
    let stores = device.stores();
    let local = Local { stores: &stores, keychain: &device.keychain, state: &device.state };
    first_upload(&local, server, keys, NOW).await
}

/// Whether `a` decrypts what `b` encrypts: the same data key.
fn same_key(a: &DataKey, b: &DataKey) -> bool {
    a.decrypt(&b.encrypt("blob é/1".as_bytes()).unwrap()).is_ok()
}

/// What another device left on the server: its blob and wrapped keys, as base64.
fn held(recovery_wrapped_key: Option<&str>) -> Contents {
    Contents {
        blob: "YmxvYiDDqQ==".to_string(),
        wrapped_key: "d3JhcHBlZCDDqQ==".to_string(),
        recovery_wrapped_key: recovery_wrapped_key.map(String::from),
    }
}

#[tokio::test]
async fn an_empty_server_makes_this_the_accounts_first_device() {
    assert_eq!(server_status(&FakeServer::default()).await.unwrap(), SetupStatus::New);
}

#[tokio::test]
async fn a_server_holding_data_asks_to_unlock_it_and_says_a_recovery_key_can() {
    let server = FakeServer::default();
    server.store(held(Some("cmVjb3Zlcnkgw6k=")));

    assert_eq!(server_status(&server).await.unwrap(), SetupStatus::Existing { recovery: true });
}

#[tokio::test]
async fn a_server_holding_no_recovery_copy_says_a_recovery_key_cannot_unlock_it() {
    let server = FakeServer::default();
    server.store(held(None));

    assert_eq!(server_status(&server).await.unwrap(), SetupStatus::Existing { recovery: false });
}

#[tokio::test]
async fn a_wrapped_key_that_is_not_base64_is_unreadable() {
    let server = FakeServer::default();
    server.store(Contents { wrapped_key: "not base64 ü".to_string(), ..held(None) });

    assert!(matches!(server_status(&server).await, Err(AppError::UnreadableSyncData)));
}

#[tokio::test]
async fn the_status_downloads_the_whole_copy_over_https() {
    let body = serde_json::to_string(&held(Some("cmVjb3Zlcnkgw6k="))).unwrap();
    let (url, requests) = serving(vec![reply("404 Not Found", "", ""), reply("200 OK", "etag: \"7\"\r\n", &body)]).await;
    let server = HttpServer::new(client().unwrap(), &url, "s3ss.ion-t0ken".to_string());

    assert_eq!(server_status(&server).await.unwrap(), SetupStatus::New);
    assert_eq!(server_status(&server).await.unwrap(), SetupStatus::Existing { recovery: true });
    let requests = received(requests).await;
    assert!(requests.iter().all(|r| r.starts_with("get /sync") && !r.contains("if-none-match")), "{requests:?}");
}

#[test]
fn a_password_shorter_than_twelve_characters_as_composed_is_refused() {
    // Twelve code points, but six characters once each accent joins its letter.
    let short = "e\u{301}".repeat(6);

    assert!(matches!(check_password(&short), Err(AppError::Validation(_))));
}

#[test]
fn a_password_of_twelve_characters_with_spaces_and_accents_is_accepted() {
    assert!(check_password("pässwörd 12/").is_ok());
}

#[test]
fn a_password_longer_than_the_limit_is_refused() {
    assert!(matches!(check_password(&"ü".repeat(MAX_PASSWORD_CHARS + 1)), Err(AppError::Validation(_))));
}

#[test]
fn new_keys_are_refused_for_a_short_password() {
    assert!(matches!(create("short pw", &cheap()), Err(AppError::Validation(_))));
}

#[test]
fn new_keys_unwrap_with_the_password_and_with_the_recovery_key_shown() {
    let (keys, shown) = create(PASSWORD, &cheap()).unwrap();
    let keys = keys.keys();

    let by_password = DataKey::unwrap_with(keys.wrapped_key, PASSWORD).unwrap();
    let recovery = RecoveryKey::parse(&shown).unwrap();
    let by_recovery = DataKey::unwrap_with_recovery(keys.recovery_wrapped_key.unwrap(), &recovery).unwrap();

    assert!(same_key(keys.data_key, &by_password) && same_key(keys.data_key, &by_recovery));
}

#[tokio::test]
async fn the_first_upload_sends_this_devices_data_with_its_wrapped_keys() {
    let (device, server, keys) = (Device::new(), FakeServer::default(), new_keys());
    device.folders.insert(folder("f/1 é", "mine. ü", 1)).unwrap();

    upload_from(&device, &server, &keys).await.unwrap();

    let contents = server.stored.borrow().clone().unwrap().contents;
    assert_eq!(BASE64.decode(&contents.wrapped_key).unwrap(), keys.keys().wrapped_key);
    assert_eq!(contents.recovery_wrapped_key.map(|k| BASE64.decode(k).unwrap()).as_deref(), keys.keys().recovery_wrapped_key);
    assert_eq!(device.state.load().last_sync, Some(NOW));
}

#[tokio::test]
async fn a_first_upload_refused_for_want_of_premium_fails_and_saves_nothing() {
    let (device, server, keys) = (Device::new(), FakeServer::default(), new_keys());
    server.lapsed.set(true);

    let result = upload_from(&device, &server, &keys).await;

    assert!(matches!(result, Err(AppError::NotPremium)), "{result:?}");
    assert!(device.state.load().server.is_none());
}

#[tokio::test]
async fn another_device_setting_up_first_asks_for_its_password_and_leaves_both_sides_alone() {
    let (device, server) = (Device::new(), FakeServer::default());
    upload_from(&Device::new(), &server, &new_keys()).await.unwrap();
    let theirs = server.stored.borrow().clone();

    let result = upload_from(&device, &server, &new_keys()).await;

    assert!(matches!(result, Err(AppError::SyncSetUpElsewhere)), "{result:?}");
    assert_eq!(*server.stored.borrow(), theirs);
    assert!(device.state.load().server.is_none());
}

#[tokio::test]
async fn a_first_upload_that_cannot_reach_the_server_reports_why() {
    let (device, server, keys) = (Device::new(), FakeServer::default(), new_keys());
    server.offline.set(true);

    let result = upload_from(&device, &server, &keys).await;

    assert!(matches!(result, Err(AppError::Io(_))), "{result:?}");
    assert!(device.state.load().server.is_none());
}

#[test]
fn held_keys_are_handed_back_under_the_session_they_were_made_in() {
    let pending = PendingSetup::default();
    pending.hold(Zeroizing::new("s3ss.ion/1 é".to_string()), new_keys());

    assert!(pending.take("s3ss.ion/1 é").is_some());
    assert!(pending.take("s3ss.ion/1 é").is_none());
}

#[test]
fn held_keys_are_dropped_once_another_session_asks_for_them() {
    let pending = PendingSetup::default();
    pending.hold(Zeroizing::new("s3ss.ion/1 é".to_string()), new_keys());

    assert!(pending.take("another s3ss.ion").is_none());
    assert!(pending.take("s3ss.ion/1 é").is_none());
}

/// The server's keys as the account's first device left them, and its recovery key.
fn held_by_first_device() -> (ServerKeys, SyncKeys, Zeroizing<String>) {
    let (keys, shown) = create(PASSWORD, &cheap()).unwrap();
    let held = ServerKeys {
        wrapped_key: keys.keys().wrapped_key.to_vec(),
        recovery_wrapped_key: keys.keys().recovery_wrapped_key.map(<[u8]>::to_vec),
    };
    (held, keys, shown)
}

fn password(text: &str) -> Secret {
    Secret::Password(Zeroizing::new(text.to_string()))
}

fn recovery(text: &str) -> Secret {
    Secret::RecoveryKey(Zeroizing::new(text.to_string()))
}

#[test]
fn the_right_password_unlocks_the_accounts_key_and_keeps_the_servers_wrapped_copies() {
    let (held, theirs, _) = held_by_first_device();

    let mine = held.unlock(&password(PASSWORD)).unwrap();

    assert!(same_key(mine.keys().data_key, theirs.keys().data_key));
    assert_eq!(mine.keys().wrapped_key, theirs.keys().wrapped_key);
    assert_eq!(mine.keys().recovery_wrapped_key, theirs.keys().recovery_wrapped_key);
}

#[test]
fn a_wrong_password_is_refused_as_wrong() {
    let (held, _, _) = held_by_first_device();

    assert!(matches!(held.unlock(&password("correct horse/battery.staple — unicode")), Err(AppError::WrongSyncPassword)));
}

#[test]
fn the_recovery_key_unlocks_the_accounts_key_however_it_is_typed() {
    let (held, theirs, shown) = held_by_first_device();
    let typed = format!("  {}  ", shown.to_lowercase().replace('-', " \u{2013} "));

    let mine = held.unlock(&recovery(&typed)).unwrap();

    assert!(same_key(mine.keys().data_key, theirs.keys().data_key));
}

#[test]
fn another_accounts_recovery_key_is_refused_as_wrong() {
    let (held, _, _) = held_by_first_device();
    let (_, _, another) = held_by_first_device();

    assert!(matches!(held.unlock(&recovery(&another)), Err(AppError::WrongRecoveryKey)));
}

#[test]
fn a_mistyped_recovery_key_is_refused_as_mistyped() {
    let (held, _, _) = held_by_first_device();

    assert!(matches!(held.unlock(&recovery("00FQ-X055-RFZM")), Err(AppError::Validation(_))));
}

#[test]
fn a_recovery_key_cannot_unlock_an_account_that_has_none() {
    let (held, _, shown) = held_by_first_device();
    let held = ServerKeys { recovery_wrapped_key: None, ..held };

    let error = held.unlock(&recovery(&shown)).err().unwrap();

    assert!(matches!(&error, AppError::Validation(message) if message.contains("no recovery key")), "{error:?}");
}

#[tokio::test]
async fn a_device_that_joins_merges_its_data_with_the_accounts() {
    let (first, joining, server) = (Device::new(), Device::new(), FakeServer::default());
    first.folders.insert(folder("f/1", "from the first. é", 1)).unwrap();
    upload_from(&first, &server, &new_keys()).await.unwrap();
    joining.folders.insert(folder("f/2", "from the joining one", 1)).unwrap();
    let keys = ServerKeys::fetch(&server).await.unwrap().unwrap().unlock(&password(PASSWORD)).unwrap();

    let stores = joining.stores();
    let local = Local { stores: &stores, keychain: &joining.keychain, state: &joining.state };
    sync(&local, &server, &keys.keys(), NOW).await.unwrap();

    let mut names: Vec<String> = joining.folders.load().into_iter().map(|f| f.name).collect();
    names.sort();
    assert_eq!(names, vec!["from the first. é", "from the joining one"]);
}
