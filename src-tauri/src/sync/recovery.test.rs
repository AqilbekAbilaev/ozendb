use super::{RecoveryKey, ALPHABET};
use crate::error::AppError;
use zeroize::Zeroizing;

// Computed independently (Python's hashlib and hmac), so a change to the format, the
// check or the derivation shows up here instead of as saved keys that stop working.
const KNOWN_BYTES: [u8; 16] = [0x00, 0x1f, 0x7e, 0x80, 0xa5, 0xc3, 0xff, 0x42, 0x99, 0x10, 0x5a, 0xe7, 0x3c, 0xd8, 0x6b, 0xf0];
const KNOWN_TEXT: &str = "00FQ-X055-RFZM-568G-BBKK-SP3B-Y3";
const KNOWN_WRAPPING_KEY: &str = "324ced4510c89a4eebb3f5f112abce554257e2f07e2b223c0875f951e335b443";

fn known() -> RecoveryKey {
    RecoveryKey(Zeroizing::new(KNOWN_BYTES))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn is_mistyped(result: Result<RecoveryKey, AppError>) -> bool {
    matches!(result, Err(AppError::Validation(message)) if message.contains("mistyped"))
}

#[test]
fn a_recovery_key_is_shown_as_26_characters_in_groups_of_four() {
    assert_eq!(known().display().as_str(), KNOWN_TEXT);
}

#[test]
fn a_recovery_key_derives_the_same_wrapping_key_on_every_version() {
    assert_eq!(hex(known().wrapping_key().unwrap().as_slice()), KNOWN_WRAPPING_KEY);
}

#[test]
fn a_shown_recovery_key_parses_back_to_the_same_key() {
    let key = RecoveryKey::generate().unwrap();
    let parsed = RecoveryKey::parse(&key.display()).unwrap();
    assert_eq!(parsed.display(), key.display());
}

#[test]
fn every_generated_recovery_key_is_different() {
    assert_ne!(RecoveryKey::generate().unwrap().display(), RecoveryKey::generate().unwrap().display());
}

#[test]
fn parsing_ignores_case_dashes_and_spaces() {
    let typed = " 00fq x055-rfzm 568g\tbbkk--sp3b y3\n";
    assert_eq!(RecoveryKey::parse(typed).unwrap().display().as_str(), KNOWN_TEXT);
}

// Crockford base32 reads the letters people confuse with digits as those digits.
#[test]
fn parsing_reads_o_as_zero_and_i_or_l_as_one() {
    assert_eq!(RecoveryKey::parse("oOFQ-X055-RFZM-568G-BBKK-SP3B-Y3").unwrap().display().as_str(), KNOWN_TEXT);
    let ones = "1111-1111-1111-1111-1111-1111-12";
    assert_eq!(RecoveryKey::parse("1Il1-L111-1111-1111-1111-1111-12").unwrap().display().as_str(), ones);
}

#[test]
fn a_key_missing_a_character_is_mistyped() {
    assert!(is_mistyped(RecoveryKey::parse(&KNOWN_TEXT[..KNOWN_TEXT.len() - 1])));
}

#[test]
fn a_key_with_an_extra_character_is_mistyped() {
    assert!(is_mistyped(RecoveryKey::parse(&format!("{KNOWN_TEXT}0"))));
}

#[test]
fn a_key_with_a_character_outside_the_alphabet_is_mistyped() {
    for stray in ['U', 'u', '*', 'é', '_'] {
        assert!(is_mistyped(RecoveryKey::parse(&KNOWN_TEXT.replacen('F', &stray.to_string(), 1))), "{stray} was accepted");
    }
}

#[test]
fn an_empty_key_is_mistyped() {
    assert!(is_mistyped(RecoveryKey::parse(" - ")));
}

// Two check bits catch three in four typos; the rest parse to a different key, which then
// fails to unlock as a wrong key rather than unlocking anything.
#[test]
fn most_single_character_typos_are_caught_as_mistyped() {
    let text: Vec<char> = KNOWN_TEXT.chars().filter(|c| *c != '-').collect();
    let (mut caught, mut total) = (0, 0);
    for at in 0..text.len() {
        for &symbol in ALPHABET.iter().filter(|s| **s as char != text[at]) {
            let mut typo = text.clone();
            typo[at] = symbol as char;
            let result = RecoveryKey::parse(&typo.iter().collect::<String>());
            total += 1;
            match result {
                Err(_) => caught += 1,
                Ok(other) => assert_ne!(other.display().as_str(), KNOWN_TEXT),
            }
        }
    }
    assert!(caught * 10 >= total * 6, "only {caught} of {total} typos were caught");
}

#[test]
fn a_recovery_key_does_not_print_its_bytes() {
    assert_eq!(format!("{:?}", known()), "RecoveryKey(..)");
}
