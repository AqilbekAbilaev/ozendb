use super::fake::{FakeKeychain, LockedKeychain, UnavailableKeychain};
use super::*;

#[test]
fn the_account_keychain_keeps_secrets_in_the_system_keychain_when_there_is_one() {
    let account = AccountKeychain::new(FakeKeychain::default());

    account.write("account::session", "s3ss.ion ü").unwrap();

    assert_eq!(account.inner().entries().get("account::session").map(String::as_str), Some("s3ss.ion ü"));
}

#[test]
fn without_a_keyring_service_the_account_keychain_keeps_secrets_in_memory() {
    let account = AccountKeychain::new(UnavailableKeychain);

    account.write("account::session", "s3ss.ion ü").unwrap();

    assert_eq!(account.read("account::session").unwrap().as_deref().map(String::as_str), Some("s3ss.ion ü"));
}

#[test]
fn without_a_keyring_service_a_removed_secret_is_gone_from_memory() {
    let account = AccountKeychain::new(UnavailableKeychain);
    account.write("sync::data-key", "k3y/with=").unwrap();

    account.remove("sync::data-key").unwrap();

    assert_eq!(account.read("sync::data-key").unwrap(), None);
}

#[test]
fn a_locked_keychain_is_still_an_error_and_never_falls_back_to_memory() {
    let account = AccountKeychain::new(LockedKeychain);

    assert!(matches!(account.write("account::session", "s3ss.ion"), Err(AppError::Keychain(_))));
    assert!(matches!(account.read("account::session"), Err(AppError::Keychain(_))));
}
