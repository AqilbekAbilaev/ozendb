use serde_json::{Map, Value};

/// Settings that describe this machine rather than the user, so they never leave
/// the device and another device's values never replace them.
pub const LOCAL_ONLY: &[&str] = &["ui_zoom"];

/// Settings as they may cross between devices: strip outgoing settings before upload,
/// and incoming ones before merging, so this device's local-only values survive.
pub fn without_local_only(mut settings: Map<String, Value>) -> Map<String, Value> {
    settings.retain(|key, _| !LOCAL_ONLY.contains(&key.as_str()));
    settings
}

#[cfg(test)]
#[path = "local_only.test.rs"]
mod tests;
