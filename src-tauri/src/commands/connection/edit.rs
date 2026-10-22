use super::usable_secrets;
use crate::error::AppError;
use crate::keychain::Keychain;
use crate::storage::{ConnectionConfig, Storage};

/// `(password, ssh_password, ssh_passphrase)` from the edit form; empty means "keep".
pub(super) type Secrets = (Option<String>, Option<String>, Option<String>);

/// Saves an edited connection, then its secrets. The record goes first: a secret
/// written for a save that then failed, or for a connection deleted meanwhile, would
/// disagree with the record, and sync would carry the wrong one to other devices.
pub(super) fn save_edit(storage: &Storage, keychain: &impl Keychain, config: &ConnectionConfig, secrets: Secrets) -> Result<(), AppError> {
    // The secrets and the record change together, so a sync can't slip in between.
    storage.with_secrets_locked(|| {
        storage.update(config.clone())?;
        let id = &config.id;
        let (password, ssh_password, ssh_passphrase) = secrets;
        let (keep_password, keep_ssh_password, keep_ssh_passphrase) = usable_secrets(config);
        let keys = [
            (id.clone(), password, keep_password),
            (format!("{}::ssh-pass", id), ssh_password, keep_ssh_password),
            (format!("{}::ssh-key-pass", id), ssh_passphrase, keep_ssh_passphrase),
        ];
        for (key, secret, usable) in keys {
            if !usable {
                // A credential doesn't outlive the setting that needed it. Failing here
                // would report a save that happened as failed, so a leftover is accepted.
                let _ = keychain.remove(&key);
            } else if let Some(secret) = secret.filter(|s| !s.is_empty()) {
                keychain.write(&key, &secret)?;
            }
        }
        Ok(())
    })
}

#[cfg(test)]
#[path = "edit.test.rs"]
mod tests;
