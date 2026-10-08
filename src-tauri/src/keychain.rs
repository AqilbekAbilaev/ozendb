use crate::error::AppError;

const SERVICE: &str = "ozendb";

pub fn set(id: &str, password: &str) -> Result<(), AppError> {
    let entry = match keyring::Entry::new(SERVICE, id) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Keychain(e.to_string())),
    };
    match entry.set_password(password) {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

pub fn get(id: &str) -> Option<String> {
    let entry = match keyring::Entry::new(SERVICE, id) {
        Ok(entry) => entry,
        Err(_) => return None,
    };
    entry.get_password().ok()
}

pub fn delete(id: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, id) {
        let _ = entry.delete_credential();
    }
}
