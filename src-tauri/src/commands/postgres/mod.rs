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

/// The primary-key column set for one table, from `pg_catalog` rather than
/// `information_schema.table_constraints`/`key_column_usage` — same source
/// `list_pg_columns` reads, so "is this a primary key" never disagrees between
/// the schema browser and `update_pg_row`'s guard. Two bugs in the
/// `information_schema` version this replaced: that view only shows constraints
/// for tables the role owns or holds a non-`SELECT` privilege on, so a
/// read-only login saw no primary key at all; and joining on constraint name
/// (unique only *per table*, not schema-wide) let a same-named constraint on a
/// different table contribute its columns to this one's key. `pg_index`/
/// `pg_attribute` have neither problem — verified against a `SELECT`-only role.
pub(super) async fn primary_key_columns(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
) -> Result<std::collections::BTreeSet<String>, AppError> {
    let rows: Vec<(String,)> = match sqlx::query_as(
        r#"
        SELECT a.attname
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey::int2[])
        WHERE i.indisprimary
            AND n.nspname = $1
            AND c.relname = $2
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
#[path = "postgres.test.rs"]
mod tests;
