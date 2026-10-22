use crate::error::AppError;
use sqlparser::ast::Statement;
use sqlparser::dialect::Dialect;
use sqlparser::parser::Parser;

/// Caller SQL as it's run: trimmed of whitespace and a trailing `;`, and refused if
/// empty or transaction control, read in the engine's `dialect`.
pub(crate) fn caller_sql<'a>(dialect: &dyn Dialect, sql: &'a str) -> Result<&'a str, AppError> {
    let trimmed = sql.trim().trim_end_matches(';');
    if trimmed.is_empty() {
        return Err(AppError::Validation("Enter a query to run.".to_string()));
    }
    refuse_transaction_control(dialect, trimmed).map_err(AppError::Validation)?;
    Ok(trimmed)
}

/// Refuses BEGIN / COMMIT / ROLLBACK / SAVEPOINT typed into the editor: run on a pooled
/// connection, a BEGIN would leave that connection mid-transaction for whichever run
/// borrows it next. The Manual switch holds a transaction properly. SQL sqlparser
/// can't read is let through for the server to judge.
pub(crate) fn refuse_transaction_control(dialect: &dyn Dialect, sql: &str) -> Result<(), String> {
    let Ok(statements) = Parser::parse_sql(dialect, sql) else { return Ok(()) };
    let controls = statements.iter().any(|s| matches!(s,
        Statement::StartTransaction { .. } | Statement::Commit { .. } | Statement::Rollback { .. }
        | Statement::Savepoint { .. } | Statement::ReleaseSavepoint { .. }));
    if controls {
        return Err("Transactions are run with the Manual switch, not typed BEGIN / COMMIT / ROLLBACK.".to_string());
    }
    Ok(())
}

#[cfg(test)]
#[path = "statement.test.rs"]
mod tests;
