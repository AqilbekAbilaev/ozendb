use crate::error::AppError;
use crate::storage::{ConnectionConfig, Storage};

/// What a command means to do with a connection. `Write` is refused on a connection
/// marked `read_only`, before anything reaches a driver.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(super) enum Access {
    Read,
    Write,
}

/// The saved config `AppContext` connects from, for either engine. Lookup and the
/// read-only gate live here once, so the eight resolvers on `AppContext` can't drift
/// apart on either rule.
pub(super) fn config_for(storage: &Storage, id: &str, access: Access) -> Result<ConnectionConfig, AppError> {
    let config = match storage.find(id) {
        Some(val) => val,
        None => return Err(AppError::UnknownConnection(id.to_string())),
    };
    if access == Access::Write && config.read_only {
        return Err(AppError::ReadOnly { name: config.name.clone() });
    }
    Ok(config)
}

#[cfg(test)]
#[path = "access.test.rs"]
mod tests;
