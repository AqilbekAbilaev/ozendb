use super::{DataKey, INTERACTIVE};
use crate::sync::recovery::RecoveryKey;
use crate::error::AppError;
use argon2::Params;
use std::collections::HashSet;

const PASSWORD: &str = "correct horse/battery.staple — ünïcödé";
const BLOB: &[u8] = "{\"conn/1\": \"pa ss.wörd\"}\0\u{00ff}".as_bytes();

// The real parameters take a noticeable fraction of a second per derivation; these keep
// the suite fast while running exactly the same code path.
fn cheap() -> Params {
    Params::new(64, 1, 1, None).expect("valid cheap parameters")
}

fn flipped(bytes: &[u8], at: usize) -> Vec<u8> {
    let mut copy = bytes.to_vec();
    copy[at] ^= 0x01;
    copy
}

#[test]
fn a_blob_round_trips_through_the_data_key() {
    let key = DataKey::generate().unwrap();
    let sealed = key.encrypt(BLOB).unwrap();
    assert_eq!(key.decrypt(&sealed).unwrap().as_slice(), BLOB);
}

#[test]
fn an_empty_blob_round_trips() {
    let key = DataKey::generate().unwrap();
    let sealed = key.encrypt(b"").unwrap();
    assert!(key.decrypt(&sealed).unwrap().is_empty());
}

#[test]
fn the_encrypted_blob_does_not_contain_the_plaintext() {
    let key = DataKey::generate().unwrap();
    let sealed = key.encrypt(BLOB).unwrap();
    assert!(!sealed.windows(BLOB.len()).any(|window| window == BLOB));
}

#[test]
fn a_blob_is_rejected_by_a_different_data_key() {
    let sealed = DataKey::generate().unwrap().encrypt(BLOB).unwrap();
    assert!(DataKey::generate().unwrap().decrypt(&sealed).is_err());
}

#[test]
fn changing_any_byte_of_an_encrypted_blob_is_detected() {
    let key = DataKey::generate().unwrap();
    let sealed = key.encrypt(BLOB).unwrap();
    for at in 0..sealed.len() {
        assert!(key.decrypt(&flipped(&sealed, at)).is_err(), "byte {at} was not authenticated");
    }
}

#[test]
fn a_truncated_blob_is_rejected() {
    let key = DataKey::generate().unwrap();
    let sealed = key.encrypt(BLOB).unwrap();
    for len in 0..sealed.len() {
        assert!(key.decrypt(&sealed[..len]).is_err(), "a blob cut to {len} bytes was accepted");
    }
}

#[test]
fn every_encryption_uses_a_fresh_nonce() {
    let key = DataKey::generate().unwrap();
    let nonces: HashSet<Vec<u8>> = (0..200).map(|_| key.encrypt(BLOB).unwrap()[1..25].to_vec()).collect();
    assert_eq!(nonces.len(), 200);
}

#[test]
fn a_blob_of_an_unknown_format_version_is_refused_by_name() {
    let key = DataKey::generate().unwrap();
    let mut sealed = key.encrypt(BLOB).unwrap();
    sealed[0] = 2;
    assert!(key.decrypt(&sealed).unwrap_err().to_string().contains("version 2"));
}

#[test]
fn a_wrapped_key_unwraps_from_its_bytes_with_the_parameters_it_records() {
    let key = DataKey::generate().unwrap();
    let stored: Vec<u8> = key.wrap(PASSWORD, &cheap()).unwrap();
    let unwrapped = DataKey::unwrap_with(&stored, PASSWORD).unwrap();
    assert_eq!(unwrapped.decrypt(&key.encrypt(BLOB).unwrap()).unwrap().as_slice(), BLOB);
}

#[test]
fn wrapping_the_same_key_twice_uses_a_fresh_salt_and_nonce() {
    let key = DataKey::generate().unwrap();
    assert_ne!(key.wrap(PASSWORD, &cheap()).unwrap(), key.wrap(PASSWORD, &cheap()).unwrap());
}

#[test]
fn a_wrong_password_is_reported_as_one() {
    let wrapped = DataKey::generate().unwrap().wrap(PASSWORD, &cheap()).unwrap();
    let error = DataKey::unwrap_with(&wrapped, "correct horse/battery.staple — unicode").unwrap_err();
    assert!(matches!(error, AppError::WrongSyncPassword));
    assert_eq!(error.code(), "wrong_sync_password");
}

#[test]
fn changing_any_byte_of_a_wrapped_key_is_detected() {
    let wrapped = DataKey::generate().unwrap().wrap(PASSWORD, &cheap()).unwrap();
    for at in 0..wrapped.len() {
        assert!(DataKey::unwrap_with(&flipped(&wrapped, at), PASSWORD).is_err(), "byte {at} was not authenticated");
    }
}

// A wrapped key has exactly one length, so any other is refused as damaged before the
// expensive derivation, even with the right password.
#[test]
fn a_wrapped_key_of_any_other_length_is_refused_as_damaged() {
    let mut wrapped = DataKey::generate().unwrap().wrap(PASSWORD, &cheap()).unwrap();
    for len in 0..wrapped.len() {
        let result = DataKey::unwrap_with(&wrapped[..len], PASSWORD);
        assert!(matches!(result, Err(AppError::Crypto(_))), "a key cut to {len} bytes was not refused as damaged");
    }
    wrapped.push(0);
    assert!(matches!(DataKey::unwrap_with(&wrapped, PASSWORD), Err(AppError::Crypto(_))));
}

#[test]
fn a_wrapped_key_of_an_unknown_format_version_is_refused_by_name() {
    let mut wrapped = DataKey::generate().unwrap().wrap(PASSWORD, &cheap()).unwrap();
    wrapped[0] = 7;
    assert!(DataKey::unwrap_with(&wrapped, PASSWORD).err().unwrap().to_string().contains("version 7"));
}

// The wrapped key comes from the server, so its parameters are untrusted: a hostile value
// must be refused before Argon2 tries to allocate it.
#[test]
fn a_wrapped_key_demanding_too_much_memory_is_refused_before_deriving() {
    let mut wrapped = DataKey::generate().unwrap().wrap(PASSWORD, &cheap()).unwrap();
    wrapped[1..5].copy_from_slice(&u32::MAX.to_be_bytes());
    assert!(matches!(DataKey::unwrap_with(&wrapped, PASSWORD), Err(AppError::Crypto(_))));
}

#[test]
fn a_data_key_does_not_print_its_bytes() {
    assert_eq!(format!("{:?}", DataKey::generate().unwrap()), "DataKey(..)");
}

// OWASP's floor for Argon2id is 19 MiB of memory with 2 passes.
#[test]
fn the_interactive_parameters_stay_above_the_owasp_minimum() {
    assert!(INTERACTIVE.m_cost() >= 19 * 1024 && INTERACTIVE.t_cost() >= 2);
}

// The same password can reach us precomposed on one system and decomposed on another.
#[test]
fn a_password_unwraps_whatever_its_unicode_form() {
    let wrapped = DataKey::generate().unwrap().wrap("caf\u{00e9} au lait", &cheap()).unwrap();
    assert!(DataKey::unwrap_with(&wrapped, "cafe\u{0301} au lait").is_ok());
}

#[test]
fn a_recovery_wrapped_key_unwraps_with_the_recovery_key_the_user_types_back() {
    let (key, recovery) = (DataKey::generate().unwrap(), RecoveryKey::generate().unwrap());
    let stored = key.wrap_for_recovery(&recovery).unwrap();
    let typed = RecoveryKey::parse(&recovery.display().to_lowercase()).unwrap();
    let unwrapped = DataKey::unwrap_with_recovery(&stored, &typed).unwrap();
    assert_eq!(unwrapped.decrypt(&key.encrypt(BLOB).unwrap()).unwrap().as_slice(), BLOB);
}

#[test]
fn wrapping_the_same_key_for_recovery_twice_uses_a_fresh_nonce() {
    let (key, recovery) = (DataKey::generate().unwrap(), RecoveryKey::generate().unwrap());
    assert_ne!(key.wrap_for_recovery(&recovery).unwrap(), key.wrap_for_recovery(&recovery).unwrap());
}

#[test]
fn a_wrong_recovery_key_is_reported_as_one() {
    let wrapped = DataKey::generate().unwrap().wrap_for_recovery(&RecoveryKey::generate().unwrap()).unwrap();
    let error = DataKey::unwrap_with_recovery(&wrapped, &RecoveryKey::generate().unwrap()).unwrap_err();
    assert!(matches!(error, AppError::WrongRecoveryKey));
    assert_eq!(error.code(), "wrong_recovery_key");
}

#[test]
fn changing_any_byte_of_a_recovery_wrapped_key_is_detected() {
    let recovery = RecoveryKey::generate().unwrap();
    let wrapped = DataKey::generate().unwrap().wrap_for_recovery(&recovery).unwrap();
    for at in 0..wrapped.len() {
        assert!(DataKey::unwrap_with_recovery(&flipped(&wrapped, at), &recovery).is_err(), "byte {at} was not authenticated");
    }
}

#[test]
fn a_recovery_wrapped_key_of_any_other_length_is_refused_as_damaged() {
    let recovery = RecoveryKey::generate().unwrap();
    let mut wrapped = DataKey::generate().unwrap().wrap_for_recovery(&recovery).unwrap();
    for len in 0..wrapped.len() {
        let result = DataKey::unwrap_with_recovery(&wrapped[..len], &recovery);
        assert!(matches!(result, Err(AppError::Crypto(_))), "a key cut to {len} bytes was not refused as damaged");
    }
    wrapped.push(0);
    assert!(matches!(DataKey::unwrap_with_recovery(&wrapped, &recovery), Err(AppError::Crypto(_))));
}

#[test]
fn a_recovery_wrapped_key_of_an_unknown_format_version_is_refused_by_name() {
    let recovery = RecoveryKey::generate().unwrap();
    let mut wrapped = DataKey::generate().unwrap().wrap_for_recovery(&recovery).unwrap();
    wrapped[0] = 9;
    assert!(DataKey::unwrap_with_recovery(&wrapped, &recovery).unwrap_err().to_string().contains("version 9"));
}

// The two wrapped forms live in separate columns; one pasted into the other's place must
// be refused, not misread.
#[test]
fn a_password_wrapped_key_is_not_accepted_as_a_recovery_wrapped_one() {
    let recovery = RecoveryKey::generate().unwrap();
    let wrapped = DataKey::generate().unwrap().wrap(PASSWORD, &cheap()).unwrap();
    assert!(matches!(DataKey::unwrap_with_recovery(&wrapped, &recovery), Err(AppError::Crypto(_))));
}

#[test]
fn a_data_key_kept_as_text_still_decrypts_what_it_encrypted() {
    let key = DataKey::generate().unwrap();
    let sealed = key.encrypt(BLOB).unwrap();
    let kept = DataKey::from_text(&key.to_text()).unwrap();
    assert_eq!(kept.decrypt(&sealed).unwrap().as_slice(), BLOB);
}

#[test]
fn kept_text_of_the_wrong_length_is_refused_as_damaged() {
    let short = "AAAA";
    assert!(matches!(DataKey::from_text(short), Err(AppError::Crypto(_))));
}

#[test]
fn kept_text_that_is_not_base64_is_refused_as_damaged() {
    assert!(matches!(DataKey::from_text("not base64 — ü"), Err(AppError::Crypto(_))));
}
