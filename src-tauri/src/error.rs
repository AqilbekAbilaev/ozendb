use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("MongoDB error: {0}")]
    Mongo(#[from] mongodb::error::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Cannot reach {address}: {reason}")]
    Unreachable { address: String, reason: String },

    #[error("Unknown connection: {0}")]
    UnknownConnection(String),

    #[error("This connection is read-only. Writes are disabled for \"{name}\".")]
    ReadOnly { name: String },

    #[error("BSON error: {0}")]
    Bson(String),

    #[error("Keychain error: {0}")]
    Keychain(String),

    #[error("Shell error: {0}")]
    Shell(String),

    #[error("SSH tunnel error: {0}")]
    Ssh(String),

    #[error("SQL error: {0}")]
    Sql(String),

    #[error("{0}")]
    Validation(String),
}

impl AppError {
    /// Stable category for logging and the structured-error wire format. The
    /// frontend branches on this (e.g. to show an auth vs network hint), so
    /// Mongo errors are classified into actionable sub-categories.
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Mongo(e) => mongo_code(e),
            AppError::Io(_) => "io",
            AppError::Serde(_) => "serde",
            AppError::Unreachable { .. } => "unreachable",
            AppError::UnknownConnection(_) => "unknown_connection",
            AppError::ReadOnly { .. } => "read_only",
            AppError::Bson(_) => "bson",
            AppError::Keychain(_) => "keychain",
            AppError::Shell(_) => "shell",
            AppError::Ssh(_) => "ssh",
            AppError::Sql(_) => "sql",
            AppError::Validation(_) => "validation",
        }
    }
}

// Tauri commands return Result<T, E> where E must implement serde::Serialize.
// We serialize as { code, message } so the frontend gets both a stable category
// to branch on and a human-readable message. This is also the single funnel
// through which every error returned to the frontend passes, so we log it here
// (with its category) for diagnosis.
#[derive(serde::Serialize)]
struct WireError<'a> {
    code: &'a str,
    message: String,
}

impl serde::Serialize for AppError {
    // This is the deliberate single funnel: every error returned to the frontend
    // passes through here, so it's the one place we log. Gate the log by category —
    // expected user-input errors (`validation`, `bson`) surface to the user as calm
    // toasts, so logging them here is just noise. Everything else is genuinely
    // unexpected / server-side, so we log it for diagnosis.
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let code = self.code();
        // Log with the full driver Display (verbose, good for diagnosis); the user-facing
        // `message` is humanized below.
        match code {
            "validation" | "bson" => {}
            _ => eprintln!("[ozendb] error [{}]: {}", code, self),
        }
        // For MongoDB errors the driver's Display can be a `{:?}` debug dump (notably
        // write/insert errors), so route them through the humanizer; every other variant
        // already Displays as a readable sentence.
        let message = match self {
            AppError::Mongo(e) => mongo_message(e),
            _ => self.to_string(),
        };
        let wire = WireError {
            code: code,
            message: message,
        };
        wire.serialize(s)
    }
}

/// Sub-categorize a MongoDB error into a stable code the frontend branches on. Auth/TLS/
/// network drive connection hints; write/insert errors are the user's own data or
/// operation (duplicate key, failed validation, …) and carry a clear server message, so
/// they get a distinct `write` code that surfaces that message directly instead of the
/// generic "database error" title. Everything else stays `mongo`.
fn mongo_code(e: &mongodb::error::Error) -> &'static str {
    use mongodb::error::ErrorKind;
    match e.kind.as_ref() {
        ErrorKind::Authentication { .. } => "auth",
        ErrorKind::InvalidTlsConfig { .. } => "tls",
        ErrorKind::ServerSelection { .. }
        | ErrorKind::DnsResolve { .. }
        | ErrorKind::ConnectionPoolCleared { .. }
        | ErrorKind::Io(_) => "network",
        ErrorKind::Write(_) | ErrorKind::InsertMany(_) => "write",
        // The server rejected the command (bad pipeline stage, not authorized, …). Its
        // own errmsg is the useful part and `mongo_message` already extracts it, so this
        // gets its own code — `mongo` is the bucket whose message is a driver dump the
        // frontend replaces with a generic title.
        ErrorKind::Command(_) => "command",
        _ => "mongo",
    }
}

/// Turn a MongoDB driver error into a concise, human-readable message. For write/insert
/// failures the driver's own Display is a `{:?}` debug dump that buries the useful
/// server text (e.g. `E11000 duplicate key error …`) inside struct noise; this pulls out
/// the server-provided message(s) instead. Every other error kind already Displays as a
/// sentence, so it passes through unchanged.
fn mongo_message(e: &mongodb::error::Error) -> String {
    use mongodb::error::{ErrorKind, WriteFailure};
    match e.kind.as_ref() {
        ErrorKind::InsertMany(insert) => {
            let mut parts: Vec<String> = Vec::new();
            if let Some(write_errors) = insert.write_errors.as_ref() {
                for write_error in write_errors {
                    parts.push(write_message(write_error.code, &write_error.message));
                }
            }
            if let Some(wc_error) = insert.write_concern_error.as_ref() {
                parts.push(write_message(wc_error.code, &wc_error.message));
            }
            match join_write_messages(parts) {
                Some(message) => message,
                None => e.to_string(),
            }
        }
        ErrorKind::Write(WriteFailure::WriteError(write_error)) => {
            write_message(write_error.code, &write_error.message)
        }
        ErrorKind::Write(WriteFailure::WriteConcernError(wc_error)) => {
            write_message(wc_error.code, &wc_error.message)
        }
        // Command failures (authorization, unsupported stage, …) Display as a driver dump
        // ("Kind: Command failed: … , labels: {}"). Pull the server's own errmsg instead —
        // the same text mongosh shows (e.g. "not authorized on <db> to execute command …").
        ErrorKind::Command(command_error) => {
            command_message(command_error.code, &command_error.message)
        }
        _ => e.to_string(),
    }
}

/// One write error as text: the server's own message, or a code-only fallback if the
/// server sent none.
fn write_message(code: i32, message: &str) -> String {
    if message.is_empty() {
        format!("Write error (code {code})")
    } else {
        message.to_string()
    }
}

/// One command error as text: the server's own `errmsg`, or a code-only fallback if the
/// server sent none.
fn command_message(code: i32, message: &str) -> String {
    if message.is_empty() {
        format!("Command failed (code {code})")
    } else {
        message.to_string()
    }
}

/// Join distinct write-error messages, capping the count so a large unordered insert
/// failure doesn't produce a wall of near-identical lines. `None` when there were no
/// messages (the caller then falls back to the driver's Display).
fn join_write_messages(parts: Vec<String>) -> Option<String> {
    let mut unique: Vec<String> = Vec::new();
    for part in parts {
        if !unique.iter().any(|existing| existing == &part) {
            unique.push(part);
        }
    }
    if unique.is_empty() {
        return None;
    }
    const MAX_SHOWN: usize = 3;
    if unique.len() <= MAX_SHOWN {
        Some(unique.join("; "))
    } else {
        let shown = unique[..MAX_SHOWN].join("; ");
        Some(format!("{} (and {} more)", shown, unique.len() - MAX_SHOWN))
    }
}

#[cfg(test)]
mod tests {
    use super::{command_message, join_write_messages, write_message};

    #[test]
    fn write_message_prefers_the_server_text() {
        assert_eq!(
            write_message(11000, "E11000 duplicate key error"),
            "E11000 duplicate key error"
        );
    }

    #[test]
    fn write_message_falls_back_to_code_when_blank() {
        assert_eq!(write_message(121, ""), "Write error (code 121)");
    }

    #[test]
    fn command_message_prefers_the_server_errmsg() {
        assert_eq!(
            command_message(13, "not authorized on testify to execute command"),
            "not authorized on testify to execute command"
        );
    }

    #[test]
    fn command_message_falls_back_to_code_when_blank() {
        assert_eq!(command_message(13, ""), "Command failed (code 13)");
    }

    #[test]
    fn join_dedups_and_returns_none_when_empty() {
        assert_eq!(join_write_messages(Vec::new()), None);
        let dupes = vec![
            String::from("E11000 dup key"),
            String::from("E11000 dup key"),
        ];
        assert_eq!(join_write_messages(dupes), Some(String::from("E11000 dup key")));
    }

    #[test]
    fn join_caps_a_large_number_of_distinct_messages() {
        let many: Vec<String> = (0..6).map(|n| format!("err {n}")).collect();
        assert_eq!(
            join_write_messages(many),
            Some(String::from("err 0; err 1; err 2 (and 3 more)"))
        );
    }
}
