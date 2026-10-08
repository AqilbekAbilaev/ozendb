// Shared persistence helper for the JSON stores.
//
// `atomic_write` writes to a sibling temp file then renames it over the target,
// so a crash or power loss mid-write can't leave a truncated/corrupt JSON file
// (a plain `fs::write` can). Each store additionally serializes its
// read-modify-write sequence with its own `std::sync::Mutex` to avoid lost
// updates when two commands touch the same file concurrently.

use crate::error::AppError;
use serde::de::DeserializeOwned;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

// Monotonic per-write sequence so two `atomic_write`s to the same target get
// distinct temp paths. The pid alone can't: every thread in this process shares
// it, so two concurrent writers would otherwise collide on one temp file.
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

pub fn atomic_write(path: &Path, content: &str) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        match std::fs::create_dir_all(parent) {
            Ok(val) => val,
            Err(e) => return Err(AppError::Io(e)),
        };
    }
    // Temp file beside the target so the rename stays on the same filesystem
    // (cross-device renames fail). pid guards against other processes, the
    // sequence against other threads in this one — together a unique temp path.
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_extension(format!("tmp.{}.{}", std::process::id(), seq));
    match std::fs::write(&tmp, content) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Io(e)),
    };
    match std::fs::rename(&tmp, path) {
        Ok(val) => val,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(AppError::Io(e));
        }
    };
    Ok(())
}

// Move a file that exists but can't be read/parsed to a timestamped sibling
// (`<name>.corrupt-<unix_ms>.<ext>`), so a later write can't overwrite recoverable
// data. Best-effort: a failed rename is logged, never panics — the caller falls
// back to its empty default either way, and quarantining is a preservation nicety
// rather than a correctness requirement.
pub fn quarantine_corrupt(path: &Path) {
    // Unix-millis suffix so repeated corruptions don't clobber each other's
    // backups. Computed inline to keep this module self-contained.
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // Preserve the original extension so the backup keeps its `.json` shape;
    // `with_extension` swaps only the extension, so the base name is kept.
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("bak");
    let backup = path.with_extension(format!("corrupt-{}.{}", ms, ext));
    eprintln!(
        "storage: quarantining unreadable file {} -> {}",
        path.display(),
        backup.display()
    );
    match std::fs::rename(path, &backup) {
        Ok(val) => val,
        Err(e) => {
            eprintln!(
                "storage: failed to quarantine {}: {}",
                path.display(),
                e
            );
        }
    };
}

// Read+parse a JSON file. Missing → `None` (the caller uses its default, and
// nothing is quarantined — an absent file isn't corruption). Present but
// unreadable/unparseable → quarantine it aside and return `None`, so the caller's
// next write can't overwrite the recoverable original.
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    if !path.exists() {
        return None;
    }
    let content = match std::fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("storage: failed to read {}: {}", path.display(), error);
            quarantine_corrupt(path);
            return None;
        }
    };
    match serde_json::from_str(&content) {
        Ok(value) => Some(value),
        Err(error) => {
            eprintln!("storage: failed to parse {}: {}", path.display(), error);
            quarantine_corrupt(path);
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::tempdir;

    // Returns the first `*.corrupt-*` sibling in `dir`, if any.
    fn find_corrupt_backup(dir: &Path) -> Option<PathBuf> {
        for entry in std::fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if file_name.contains(".corrupt-") {
                return Some(entry.path());
            }
        }
        None
    }

    #[test]
    fn read_json_missing_file_returns_none_without_backup() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.json");
        let parsed: Option<Vec<String>> = read_json(&path);
        assert!(parsed.is_none());
        // A missing file is not corruption: nothing is quarantined.
        assert!(find_corrupt_backup(dir.path()).is_none());
    }

    #[test]
    fn read_json_corrupt_file_quarantines_and_returns_none() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.json");
        std::fs::write(&path, "not valid json {{").unwrap();
        let parsed: Option<Vec<String>> = read_json(&path);
        assert!(parsed.is_none());
        // The corrupt file is moved aside, not left at the target path...
        assert!(!path.exists());
        // ...and its original bytes survive in the backup.
        let backup = find_corrupt_backup(dir.path())
            .expect("a .corrupt-* backup should exist");
        assert_eq!(
            std::fs::read_to_string(&backup).unwrap(),
            "not valid json {{"
        );
    }

    #[test]
    fn read_json_valid_file_returns_parsed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.json");
        std::fs::write(&path, r#"["a","b"]"#).unwrap();
        let parsed: Option<Vec<String>> = read_json(&path);
        assert_eq!(
            parsed,
            Some(vec![String::from("a"), String::from("b")])
        );
        // A valid read leaves the file in place and creates no backup.
        assert!(path.exists());
        assert!(find_corrupt_backup(dir.path()).is_none());
    }
}
