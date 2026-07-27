// Trust-on-first-use (TOFU) store for SSH host keys.
//
// We compare the key a bastion presents against what we have on file: a match is
// accepted, a brand-new host triggers a first-contact prompt (and is recorded
// only once the user approves — see ssh.rs), and a *changed* key is rejected
// (possible man-in-the-middle, or a rotated server key). This replaces the
// previous accept-all policy in ssh.rs.
//
// Keyed by `host:port`, not by connection id, because several connections can
// share one bastion and should trust the same key.

use crate::error::AppError;
use crate::json_store::JsonStore;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct KnownHost {
    pub host: String,
    pub port: u16,
    // The server's public key in OpenSSH authorized_keys form (`<algo> <base64>`).
    pub key: String,
    // Milliseconds since the Unix epoch when this key was first trusted.
    pub added: String,
}

/// The result of comparing a presented key against what we have on file.
#[derive(Debug, PartialEq)]
pub enum HostKeyCheck {
    /// The presented key matches the stored one.
    Match,
    /// No key on file for this host yet (first contact).
    Unknown,
    /// A different key is already stored for this host.
    Changed,
}

/// Pure three-way decision, separated from any I/O so it can be unit-tested.
pub fn classify(stored: Option<&str>, presented: &str) -> HostKeyCheck {
    match stored {
        None => HostKeyCheck::Unknown,
        Some(value) => {
            if value == presented {
                HostKeyCheck::Match
            } else {
                HostKeyCheck::Changed
            }
        }
    }
}

pub struct KnownHostsStore {
    // The JsonStore's lock serializes the load-modify-save sequence so two
    // first-contact connections can't lose each other's recorded keys.
    inner: JsonStore<Vec<KnownHost>>,
}

impl KnownHostsStore {
    pub fn new(path: PathBuf) -> Self {
        Self { inner: JsonStore::new(path) }
    }

    fn load_all(&self) -> Vec<KnownHost> {
        self.inner.load()
    }

    /// Read-only TOFU comparison — does the presented key match, is this a new
    /// host, or has its key changed? Writes nothing; the caller decides what to
    /// do (prompt, accept, reject) based on the verdict.
    pub fn check(&self, host: &str, port: u16, presented: &str) -> HostKeyCheck {
        let hosts = self.load_all();
        let stored = hosts
            .iter()
            .find(|h| h.host == host && h.port == port)
            .map(|h| h.key.as_str());
        classify(stored, presented)
    }

    /// The OpenSSH-form key currently trusted for this host, if any. Used to
    /// show the previously-trusted fingerprint when a key has changed.
    pub fn stored_key(&self, host: &str, port: u16) -> Option<String> {
        self.load_all()
            .into_iter()
            .find(|h| h.host == host && h.port == port)
            .map(|h| h.key)
    }

    /// Trust a host's key — called after the user approves a first-contact
    /// prompt. Replaces any existing entry for this host:port so a deliberate
    /// re-trust (after a `remove`) can't leave a duplicate.
    pub fn record(&self, host: &str, port: u16, key: &str) -> Result<(), AppError> {
        self.inner.update(|hosts| {
            hosts.retain(|h| !(h.host == host && h.port == port));
            hosts.push(KnownHost {
                host: host.to_string(),
                port: port,
                key: key.to_string(),
                added: crate::time::now_ms(),
            });
        })
    }

    /// Drop a host's trusted key ("forget host"), so the next connection is
    /// treated as a fresh first contact. The recovery path after a legitimate
    /// key rotation.
    pub fn remove(&self, host: &str, port: u16) -> Result<(), AppError> {
        self.inner.update(|hosts| {
            hosts.retain(|h| !(h.host == host && h.port == port));
        })
    }
}


#[cfg(test)]
#[path = "known_hosts.test.rs"]
mod tests;
