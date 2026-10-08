//! The events the backend raises. Their names are a string contract with the frontend,
//! which subscribes to each in `src/appApi/events.js`; the test reads that file so a
//! rename on either side fails here rather than going silent in the app.

pub const MENU_ACTION: &str = "menu-action";
pub const OPERATIONS_CHANGED: &str = "operations-changed";
pub const DOCUMENT_TARGET: &str = "document-target";
pub const SSH_HOST_KEY_PROMPT: &str = "ssh-host-key-prompt";
pub const SSH_HOST_KEY_CHANGED: &str = "ssh-host-key-changed";

#[cfg(test)]
#[path = "events.test.rs"]
mod tests;
