//! The recovery key: the user's way back to their sync data if they forget the sync
//! password. It is 128 random bits that wrap the same data key the password does.
//!
//! It is shown as 26 Crockford base32 characters in groups of four, such as
//! `00FQ-X055-RFZM-568G-BBKK-SP3B-Y3`. Crockford's alphabet leaves out I, L, O and U, and
//! parsing reads O as 0 and I or L as 1, so a key copied by hand still reads back. 26
//! characters hold 130 bits; the 2 left over carry a check (the top bits of the key's
//! SHA-256), which catches three typos in four as "mistyped" without making the key any
//! longer. A typo the check misses parses to a different key and is refused as a wrong one.
//!
//! Wiping is best effort, as in crypto.rs: the caller's typed text is never wiped here.

use super::crypto::{random, KEY_LEN};
use crate::error::AppError;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use std::fmt;
use zeroize::Zeroizing;

const SECRET_LEN: usize = 16;
const SYMBOLS: usize = 26;
const BITS: usize = SYMBOLS * 5;
pub(super) const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
// Domain separation: this derived key wraps the data key and must never match a key
// derived from the same secret for any other purpose.
const WRAPPING_INFO: &[u8] = b"ozendb sync: data key wrapped by recovery key v1";

pub struct RecoveryKey(Zeroizing<[u8; SECRET_LEN]>);

impl RecoveryKey {
    pub fn generate() -> Result<Self, AppError> {
        Ok(Self(Zeroizing::new(random()?)))
    }

    pub fn parse(typed: &str) -> Result<Self, AppError> {
        let mut symbols = Zeroizing::new([0u8; SYMBOLS]);
        let mut count = 0;
        for c in typed.chars().filter(|c| *c != '-' && !c.is_whitespace()) {
            let symbol = match c.to_ascii_uppercase() {
                'O' => b'0',
                'I' | 'L' => b'1',
                other => u8::try_from(other).map_err(|_| mistyped())?,
            };
            let value = ALPHABET.iter().position(|a| *a == symbol).ok_or_else(mistyped)?;
            *symbols.get_mut(count).ok_or_else(mistyped)? = value as u8;
            count += 1;
        }
        if count != SYMBOLS {
            return Err(mistyped());
        }
        let bit = |n: usize| symbols[n / 5] >> (4 - n % 5) & 1;
        let mut secret = Zeroizing::new([0u8; SECRET_LEN]);
        for n in 0..SECRET_LEN * 8 {
            secret[n / 8] |= bit(n) << (7 - n % 8);
        }
        let check = bit(BITS - 2) << 1 | bit(BITS - 1);
        if check != check_of(&secret) {
            return Err(mistyped());
        }
        Ok(Self(secret))
    }

    pub fn display(&self) -> Zeroizing<String> {
        let check = check_of(&self.0);
        let bit = |n: usize| match n {
            n if n < SECRET_LEN * 8 => self.0[n / 8] >> (7 - n % 8) & 1,
            n => check >> (BITS - 1 - n) & 1,
        };
        let mut text = Zeroizing::new(String::with_capacity(SYMBOLS + SYMBOLS / 4));
        for at in 0..SYMBOLS {
            if at > 0 && at % 4 == 0 {
                text.push('-');
            }
            let value = (0..5).fold(0, |value, j| value << 1 | bit(at * 5 + j));
            text.push(ALPHABET[value as usize] as char);
        }
        text
    }

    // HKDF rather than Argon2id: the secret is already 128 uniformly random bits, so there
    // is nothing for a slow hash to strengthen; HKDF-SHA256 (RFC 5869) only stretches it
    // to a 256-bit key bound to its purpose. No salt, which RFC 5869 allows for an input
    // this random; every wrap still differs through its random nonce.
    pub(super) fn wrapping_key(&self) -> Result<Zeroizing<[u8; KEY_LEN]>, AppError> {
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        Hkdf::<Sha256>::new(None, self.0.as_slice())
            .expand(WRAPPING_INFO, key.as_mut_slice())
            .map_err(|e| AppError::Crypto(format!("The recovery key could not be turned into a key: {e}.")))?;
        Ok(key)
    }
}

impl fmt::Debug for RecoveryKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("RecoveryKey(..)")
    }
}

// The top two bits of the secret's SHA-256.
fn check_of(secret: &[u8; SECRET_LEN]) -> u8 {
    Sha256::digest(secret)[0] >> 6
}

fn mistyped() -> AppError {
    AppError::Validation("This recovery key is mistyped. Check it against the one you saved.".into())
}

#[cfg(test)]
#[path = "recovery.test.rs"]
mod tests;
