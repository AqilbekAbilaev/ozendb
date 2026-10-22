use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("MongoDB error: {0}")]
    Mongo(#[from] mongodb::error::Error),

    #[error("Postgres error: {0}")]
    Postgres(#[from] sqlx::Error),

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

    #[error("No keyring service was found: {0}")]
    KeychainUnavailable(String),

    #[error("Shell error: {0}")]
    Shell(String),

    #[error("SSH tunnel error: {0}")]
    Ssh(String),

    #[error("SQL error: {0}")]
    Sql(String),

    #[error("Encryption error: {0}")]
    Crypto(String),

    #[error("The sync password is incorrect.")]
    WrongSyncPassword,

    #[error("The recovery key is incorrect.")]
    WrongRecoveryKey,

    #[error("The sync data was saved by a newer version of OzenDB. Update OzenDB to keep syncing.")]
    NewerSyncFormat,

    #[error("The downloaded sync data could not be read.")]
    UnreadableSyncData,

    #[error("The sync data kept changing while it synced; it will try again.")]
    SyncKeptChanging,

    #[error("Sync is not set up on this device yet.")]
    SyncNotSetUp,

    #[error("Another device set up sync for this account first. Enter its sync password to join it.")]
    SyncSetUpElsewhere,

    #[error("You were signed out. Sign in again to keep syncing.")]
    SignedOut,

    #[error("Uploading sync data needs OzenDB Premium.")]
    NotPremium,

    #[error("The sync data is too large for the sync server to store.")]
    SyncDataTooLarge,

    #[error("The sync server is busy; it will try again later.")]
    SyncRateLimited,

    #[error("The sync server answered with an error ({0}); it will try again.")]
    SyncServer(u16),

    #[error("This sign-in request has expired. Start signing in again.")]
    SignInExpired,

    #[error("Too many requests to the OzenDB server. Try again in a minute.")]
    AccountRateLimited,

    #[error("The OzenDB server answered with an error ({0}).")]
    AccountServer(u16),

    #[error("For your safety, sign in again before deleting the account.")]
    SignInAgain,

    #[error("Cancel the subscription before deleting the account.")]
    SubscriptionActive,

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
            AppError::Postgres(e) => postgres_code(e),
            AppError::Io(_) => "io",
            AppError::Serde(_) => "serde",
            AppError::Unreachable { .. } => "unreachable",
            AppError::UnknownConnection(_) => "unknown_connection",
            AppError::ReadOnly { .. } => "read_only",
            AppError::Bson(_) => "bson",
            AppError::Keychain(_) => "keychain",
            AppError::KeychainUnavailable(_) => "keychain_unavailable",
            AppError::Shell(_) => "shell",
            AppError::Ssh(_) => "ssh",
            AppError::Sql(_) => "sql",
            AppError::Crypto(_) => "crypto",
            AppError::WrongSyncPassword => "wrong_sync_password",
            AppError::WrongRecoveryKey => "wrong_recovery_key",
            AppError::NewerSyncFormat => "newer_sync_format",
            AppError::UnreadableSyncData => "unreadable_sync_data",
            AppError::SyncKeptChanging => "sync_kept_changing",
            AppError::SyncNotSetUp => "sync_not_set_up",
            AppError::SyncSetUpElsewhere => "sync_set_up_elsewhere",
            AppError::SignedOut => "signed_out",
            AppError::NotPremium => "not_premium",
            AppError::SyncDataTooLarge => "sync_data_too_large",
            AppError::SyncRateLimited => "sync_rate_limited",
            AppError::SyncServer(_) => "sync_server",
            AppError::SignInExpired => "sign_in_expired",
            AppError::AccountRateLimited => "account_rate_limited",
            AppError::AccountServer(_) => "account_server",
            AppError::SignInAgain => "sign_in_again",
            AppError::SubscriptionActive => "subscription_active",
            AppError::Validation(_) => "validation",
        }
    }
}

// What the frontend receives for a failed command (src/utils/errors.js reads it): a
// stable category to branch on and a human-readable message.
#[derive(serde::Serialize)]
struct WireError<'a> {
    code: &'a str,
    message: String,
}

impl AppError {
    // The message the user sees. For MongoDB errors the driver's Display can be a `{:?}`
    // debug dump (notably write/insert errors), so route them through the humanizer;
    // every other variant already Displays as a readable sentence.
    pub(crate) fn user_message(&self) -> String {
        match self {
            AppError::Mongo(e) => mongo_message(e),
            AppError::Postgres(e) => postgres_message(e),
            _ => self.to_string(),
        }
    }

    // The wire shape, and nothing else — no logging, so building it is safe anywhere.
    fn wire(&self) -> WireError<'_> {
        WireError {
            code: self.code(),
            message: self.user_message(),
        }
    }

    // Expected user-input errors (`validation`, `bson`) surface as calm toasts, so they
    // aren't worth a stderr line; everything else is printed with the full driver
    // Display, which is verbose and good for diagnosis. The ones that are ours to fix
    // (see error_log::is_defect) are also kept so they can be reported later — a failed
    // login or an unreachable host is not one of them.
    fn report(&self) {
        let code = self.code();
        match code {
            "validation" | "bson" => {}
            _ => eprintln!("[ozendb] error [{}]: {}", code, self),
        }
        crate::error_log::record(code, &self.to_string());
    }
}

// Every command's `Err` is converted here on its way to the frontend, exactly once, so this
// is where it's logged. `AppError` deliberately doesn't implement `Serialize`: Tauri's blanket
// conversion would then take over and skip the report.
impl From<AppError> for tauri::ipc::InvokeError {
    fn from(error: AppError) -> Self {
        error.report();
        tauri::ipc::InvokeError::from(error.wire())
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

/// Sub-categorize a Postgres error the same way `mongo_code` does for MongoDB: auth/TLS/
/// network drive connection hints, a server-rejected statement (bad SQL, permission
/// denied, constraint violation, …) gets `command` since its own message is the useful
/// part, everything else stays `postgres`.
fn postgres_code(e: &sqlx::Error) -> &'static str {
    match e {
        // SQLSTATE 28000/28P01 are Postgres's invalid-authorization/invalid-password
        // classes; every other database-rejected statement is a `command` error.
        sqlx::Error::Database(db_err) => match db_err.code().as_deref() {
            Some("28000") | Some("28P01") => "auth",
            // query_canceled: the user's Cancel, or the statement timeout.
            Some("57014") => "cancelled",
            // insufficient_privilege, and undefined_table / invalid_schema_name: the
            // frontend words these for the table they name (a dropped or unreadable tab).
            Some("42501") => "forbidden",
            Some("42P01") | Some("3F000") => "missing",
            _ => "command",
        },
        sqlx::Error::Tls(_) => "tls",
        sqlx::Error::Io(_) | sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed
        | sqlx::Error::WorkerCrashed => "network",
        sqlx::Error::Configuration(_) | sqlx::Error::InvalidArgument(_) => "validation",
        _ => "postgres",
    }
}

/// Turn a Postgres driver error into a concise, human-readable message. A
/// server-rejected statement's own message (e.g. `relation "x" does not exist`) is
/// already the useful part; every other error kind already Displays as a sentence.
fn postgres_message(e: &sqlx::Error) -> String {
    match e {
        sqlx::Error::Database(db_err) if db_err.code().as_deref() == Some("57014") => {
            if db_err.message().contains("statement timeout") {
                String::from("The query ran past its time limit and was stopped.")
            } else {
                String::from("The query was cancelled.")
            }
        }
        // lock_not_available: a schema change gave up waiting on its `lock_timeout`.
        sqlx::Error::Database(db_err) if db_err.code().as_deref() == Some("55P03") => String::from(
            "The table is in use by an open transaction, in another tab or session. Commit or roll it back, then try again.",
        ),
        sqlx::Error::Database(db_err) => db_err.message().to_string(),
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
#[path = "error.test.rs"]
mod tests;
