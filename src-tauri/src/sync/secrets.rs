//! A connection's keychain secrets travel in the sync blob inside its record, so they
//! follow the merge: the device whose record wins also supplies the secrets, and a
//! deleted record carries none. The blob is encrypted end to end (`crypto.rs`); exports
//! stay credential-free.

use crate::error::AppError;
use crate::keychain::Keychain;
use crate::record::{Record, Stamp, Stamped};
use crate::storage::ConnectionConfig;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use zeroize::Zeroizing;

/// A connection record as it travels in the sync blob.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncedConnection {
    config: ConnectionConfig,
    #[serde(default)]
    secrets: ConnectionSecrets,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct ConnectionSecrets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password: Option<Secret>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ssh_password: Option<Secret>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ssh_passphrase: Option<Secret>,
}

/// Wiped from memory on drop, and never shown by `Debug`.
#[derive(Clone)]
struct Secret(Zeroizing<String>);

impl SyncedConnection {
    /// The record with the secrets this device holds for it. A deleted record carries none.
    pub fn collect(config: ConnectionConfig, keychain: &impl Keychain) -> Result<Self, AppError> {
        if config.stamp.deleted {
            return Ok(Self { config, secrets: ConnectionSecrets::default() });
        }
        let [password, ssh_password, ssh_passphrase] = keys(&config.id);
        let read = |key: String| Ok::<_, AppError>(keychain.read(&key)?.map(Secret));
        let secrets = ConnectionSecrets {
            password: read(password)?,
            ssh_password: read(ssh_password)?,
            ssh_passphrase: read(ssh_passphrase)?,
        };
        Ok(Self { config, secrets })
    }

    /// Makes this device's keychain hold exactly the record's secrets: each one it
    /// carries is written, and each it lacks is removed, so a deleted record or a
    /// secret dropped on the winning device leaves nothing behind here.
    pub fn save_secrets(&self, keychain: &impl Keychain) -> Result<(), AppError> {
        let secrets = [&self.secrets.password, &self.secrets.ssh_password, &self.secrets.ssh_passphrase];
        for (key, secret) in keys(&self.config.id).iter().zip(secrets) {
            match secret {
                Some(Secret(value)) => keychain.write(key, value)?,
                None => keychain.remove(key)?,
            }
        }
        Ok(())
    }

    pub fn config(&self) -> &ConnectionConfig {
        &self.config
    }

    /// These secrets on `config`, which a merge may have changed. A deleted record
    /// carries none.
    pub fn with_config(self, config: ConnectionConfig) -> Self {
        let secrets = if config.stamp.deleted { ConnectionSecrets::default() } else { self.secrets };
        Self { config, secrets }
    }

    /// Whether this record's secrets differ from what `previous` held, or from none.
    pub fn secrets_differ(&self, previous: Option<&SyncedConnection>) -> bool {
        let none = ConnectionSecrets::default();
        let previous = previous.map_or(&none, |p| &p.secrets);
        let same = |a: &Option<Secret>, b: &Option<Secret>| match (a, b) {
            (Some(Secret(a)), Some(Secret(b))) => a.as_str() == b.as_str(),
            (a, b) => a.is_none() && b.is_none(),
        };
        !(same(&self.secrets.password, &previous.password)
            && same(&self.secrets.ssh_password, &previous.ssh_password)
            && same(&self.secrets.ssh_passphrase, &previous.ssh_passphrase))
    }

    /// Whether this record's shared part or secrets differ from `previous`, or from none.
    pub fn differs_from(&self, previous: Option<&SyncedConnection>) -> bool {
        previous.is_none_or(|p| p.config.shared_part() != self.config.shared_part()) || self.secrets_differ(previous)
    }

    /// The record without its secrets, as the connection store keeps it.
    pub fn into_config(self) -> ConnectionConfig {
        self.config
    }
}

// The keys `commands/connection.rs` stores a connection's secrets under.
fn keys(id: &str) -> [String; 3] {
    [id.to_string(), format!("{id}::ssh-pass"), format!("{id}::ssh-key-pass")]
}

impl Stamped for SyncedConnection {
    fn stamp(&self) -> &Stamp {
        &self.config.stamp
    }

    fn restamp(&mut self, stamp: Stamp) {
        self.config.stamp = stamp;
    }
}

impl Record for SyncedConnection {
    fn id(&self) -> String {
        self.config.id()
    }

    fn emptied(&self) -> Self {
        Self { config: self.config.emptied(), secrets: ConnectionSecrets::default() }
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(..)")
    }
}

impl Serialize for Secret {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(|value| Secret(Zeroizing::new(value)))
    }
}

#[cfg(test)]
#[path = "secrets.test.rs"]
mod tests;
