//! End-to-end encryption for sync. A random data key encrypts the sync blob; the data key
//! itself is stored on the server wrapped under a key derived from the user's sync
//! password, so the server holds nothing it can read.
//!
//! The data key is also wrapped a second time under the user's recovery key (see
//! recovery.rs), stored separately so either wrapping can be replaced on its own.
//!
//! All three formats are `header ‖ nonce ‖ ciphertext`, and the header and nonce are the
//! XChaCha20-Poly1305 associated data, so no field can be altered or swapped unnoticed:
//!
//! - encrypted blob: `version (1) ‖ nonce (24) ‖ ciphertext and tag`
//! - wrapped key: `version (1) ‖ memory KiB, passes, lanes (u32 big-endian each) ‖
//!   salt (16) ‖ nonce (24) ‖ encrypted key and tag (48)`
//! - recovery-wrapped key: `version (1) ‖ nonce (24) ‖ encrypted key and tag (48)`
//!
//! The wrapped key records its own Argon2id parameters, so they can be raised for new
//! keys without locking out existing ones. The password is normalised to Unicode NFC
//! before deriving, so the same password typed on systems that compose accents
//! differently still unwraps the key.
//!
//! Wiping keys from memory on drop is best effort only: the NFC copy of the password can
//! leave earlier allocations behind while it grows, and the caller's password is never
//! wiped here.

use super::recovery::RecoveryKey;
use crate::error::AppError;
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, Generate, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use std::fmt;
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

const BLOB_VERSION: u8 = 1;
const WRAP_VERSION: u8 = 1;
const RECOVERY_WRAP_VERSION: u8 = 1;
pub(super) const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;
const SALT_LEN: usize = 16;
const TAG_LEN: usize = 16;
const WRAP_HEADER_LEN: usize = 1 + 3 * 4 + SALT_LEN;
const WRAPPED_LEN: usize = WRAP_HEADER_LEN + NONCE_LEN + KEY_LEN + TAG_LEN;
const RECOVERY_WRAPPED_LEN: usize = 1 + NONCE_LEN + KEY_LEN + TAG_LEN;

// RFC 9106 §4's second recommended choice (64 MiB, 3 passes), well above OWASP's 19 MiB
// minimum: the cost is paid once per device, not per request, so we can afford it. One
// lane, because without the `parallel` feature lanes run one after another, which would
// slow us down and not an attacker.
pub const INTERACTIVE: Params = match Params::new(64 * 1024, 3, 1, None) {
    Ok(params) => params,
    Err(_) => panic!("invalid Argon2id parameters"),
};

// A wrapped key comes from the server, so its parameters are untrusted. These ceilings
// stop a hostile one from making us allocate gigabytes or run for hours.
const MAX_MEMORY_KIB: u32 = 1024 * 1024;
const MAX_PASSES: u32 = 32;
const MAX_LANES: u32 = 16;

pub struct DataKey(Zeroizing<[u8; KEY_LEN]>);

impl DataKey {
    pub fn generate() -> Result<Self, AppError> {
        Ok(Self(Zeroizing::new(random()?)))
    }

    pub fn wrap(&self, password: &str, params: &Params) -> Result<Vec<u8>, AppError> {
        let salt: [u8; SALT_LEN] = random()?;
        let mut header = vec![WRAP_VERSION];
        for cost in [params.m_cost(), params.t_cost(), params.p_cost()] {
            header.extend(cost.to_be_bytes());
        }
        header.extend(salt);
        let wrapping = derive(password, &salt, params.clone())?;
        seal(&wrapping, header, self.0.as_slice())
    }

    pub fn unwrap_with(wrapped: &[u8], password: &str) -> Result<Self, AppError> {
        readable(*wrapped.first().ok_or_else(|| damaged("sync key"))?, WRAP_VERSION, "sync key")?;
        if wrapped.len() != WRAPPED_LEN {
            return Err(damaged("sync key"));
        }
        let header = &wrapped[..WRAP_HEADER_LEN];
        let cost = |at: usize| u32::from_be_bytes([header[at], header[at + 1], header[at + 2], header[at + 3]]);
        let (memory, passes, lanes) = (cost(1), cost(5), cost(9));
        if memory > MAX_MEMORY_KIB || passes > MAX_PASSES || lanes > MAX_LANES {
            return Err(damaged("sync key"));
        }
        let params = Params::new(memory, passes, lanes, None).map_err(|_| damaged("sync key"))?;
        let wrapping = derive(password, &header[WRAP_HEADER_LEN - SALT_LEN..], params)?;
        // An authentication failure here cannot tell a wrong password from an altered key;
        // the wrong password is by far the likelier, so that is what the user is told.
        let plaintext = open(&wrapping, wrapped, WRAP_HEADER_LEN).ok_or(AppError::WrongSyncPassword)?;
        // WRAPPED_LEN fixes the plaintext at exactly KEY_LEN bytes.
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        key.copy_from_slice(&plaintext);
        Ok(Self(key))
    }

    pub fn wrap_for_recovery(&self, recovery: &RecoveryKey) -> Result<Vec<u8>, AppError> {
        let wrapping = recovery.wrapping_key()?;
        seal(&wrapping, vec![RECOVERY_WRAP_VERSION], self.0.as_slice())
    }

    pub fn unwrap_with_recovery(wrapped: &[u8], recovery: &RecoveryKey) -> Result<Self, AppError> {
        let what = "recovery copy of the sync key";
        readable(*wrapped.first().ok_or_else(|| damaged(what))?, RECOVERY_WRAP_VERSION, what)?;
        if wrapped.len() != RECOVERY_WRAPPED_LEN {
            return Err(damaged(what));
        }
        // As with the password, a failure here most likely means the wrong recovery key.
        let wrapping = recovery.wrapping_key()?;
        let plaintext = open(&wrapping, wrapped, 1).ok_or(AppError::WrongRecoveryKey)?;
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        key.copy_from_slice(&plaintext);
        Ok(Self(key))
    }

    /// The key as text, to keep in this device's keychain between launches.
    pub fn to_text(&self) -> Zeroizing<String> {
        Zeroizing::new(BASE64.encode(self.0.as_slice()))
    }

    /// The key kept as `to_text` wrote it.
    pub fn from_text(text: &str) -> Result<Self, AppError> {
        let bytes = Zeroizing::new(BASE64.decode(text).map_err(|_| damaged("kept sync key"))?);
        if bytes.len() != KEY_LEN {
            return Err(damaged("kept sync key"));
        }
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        key.copy_from_slice(&bytes);
        Ok(Self(key))
    }

    pub fn encrypt(&self, blob: &[u8]) -> Result<Vec<u8>, AppError> {
        seal(&self.0, vec![BLOB_VERSION], blob)
    }

    pub fn decrypt(&self, sealed: &[u8]) -> Result<Zeroizing<Vec<u8>>, AppError> {
        readable(*sealed.first().ok_or_else(|| damaged("sync data"))?, BLOB_VERSION, "sync data")?;
        open(&self.0, sealed, 1).ok_or_else(|| damaged("sync data"))
    }
}

impl fmt::Debug for DataKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DataKey(..)")
    }
}

fn seal(key: &[u8; KEY_LEN], mut header: Vec<u8>, plaintext: &[u8]) -> Result<Vec<u8>, AppError> {
    let nonce: [u8; NONCE_LEN] = random()?;
    header.extend(nonce);
    let ciphertext = XChaCha20Poly1305::new(key.into())
        .encrypt(&XNonce::from(nonce), Payload { msg: plaintext, aad: &header })
        .map_err(|_| AppError::Crypto("The sync data could not be encrypted.".into()))?;
    header.extend(ciphertext);
    Ok(header)
}

// `None` when the bytes are too short to hold a nonce or fail authentication.
fn open(key: &[u8; KEY_LEN], sealed: &[u8], header_len: usize) -> Option<Zeroizing<Vec<u8>>> {
    let (aad, ciphertext) = sealed.split_at_checked(header_len + NONCE_LEN)?;
    let nonce = XNonce::try_from(&aad[header_len..]).ok()?;
    XChaCha20Poly1305::new(key.into())
        .decrypt(&nonce, Payload { msg: ciphertext, aad })
        .ok()
        .map(Zeroizing::new)
}

fn derive(password: &str, salt: &[u8], params: Params) -> Result<Zeroizing<[u8; KEY_LEN]>, AppError> {
    let password = Zeroizing::new(password.nfc().collect::<String>());
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut_slice())
        .map_err(|e| AppError::Crypto(format!("The sync password could not be turned into a key: {e}.")))?;
    Ok(key)
}

pub(super) fn random<const N: usize>() -> Result<[u8; N], AppError> {
    <[u8; N]>::try_generate()
        .map_err(|e| AppError::Crypto(format!("The system's random number generator failed: {e}.")))
}

fn readable(version: u8, supported: u8, what: &str) -> Result<(), AppError> {
    if version == supported {
        return Ok(());
    }
    Err(AppError::Crypto(format!(
        "The {what} uses format version {version}, which this version of OzenDB cannot read."
    )))
}

fn damaged(what: &str) -> AppError {
    AppError::Crypto(format!("The {what} is damaged or was altered."))
}

#[cfg(test)]
#[path = "crypto.test.rs"]
mod tests;
