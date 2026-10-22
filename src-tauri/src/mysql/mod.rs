//! MySQL's engine-side modules outside the command layer. So far a saved MySQL
//! connection can only be described, not dialled.
use crate::error::AppError;

pub mod uri;

/// What every path that would dial a MySQL server returns until one can.
// TODO #386: connect through sqlx's MySQL driver, then drop this.
pub(crate) fn not_available() -> AppError {
    AppError::Validation("Connecting to MySQL isn't available yet.".to_string())
}
