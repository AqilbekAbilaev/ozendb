use crate::error::AppError;

pub(super) use super::AppContext;

pub mod schema;
pub mod query;

pub use schema::*;
pub use query::*;

/// Double-quotes a Postgres identifier (schema/table/column name), escaping any
/// embedded `"` by doubling it — the standard Postgres quoted-identifier rule.
/// A bind parameter (`$1`) can carry a value safely, but never an identifier, so
/// any SQL here that splices a caller-supplied name into the query text goes
/// through this first.
pub(super) fn quote_ident(name: &str) -> Result<String, AppError> {
    if name.is_empty() {
        return Err(AppError::Validation("Expected a non-empty identifier.".to_string()));
    }
    Ok(format!("\"{}\"", name.replace('"', "\"\"")))
}

/// The primary-key column set for one table, from `information_schema` rather
/// than `pg_index` — same source `list_pg_columns` reads, so "is this a primary
/// key" never disagrees between the schema browser and `update_pg_row`'s guard.
pub(super) async fn primary_key_columns(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
) -> Result<std::collections::BTreeSet<String>, AppError> {
    let rows: Vec<(String,)> = match sqlx::query_as(
        r#"
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = $1
            AND tc.table_name = $2
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    Ok(rows.into_iter().map(|(name,)| name).collect())
}

#[cfg(test)]
mod tests {
    use super::quote_ident;

    #[test]
    fn quote_ident_wraps_a_plain_name() {
        assert_eq!(quote_ident("users").unwrap(), "\"users\"");
    }

    #[test]
    fn quote_ident_doubles_embedded_quotes() {
        // The name `a"b` must become `"a""b"` — a literal double quote inside a
        // quoted identifier is escaped by doubling it, not backslash-escaped.
        assert_eq!(quote_ident("a\"b").unwrap(), "\"a\"\"b\"");
    }

    #[test]
    fn quote_ident_rejects_empty() {
        assert_eq!(quote_ident("").unwrap_err().code(), "validation");
    }
}
