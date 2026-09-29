use crate::error::AppError;
use serde::Serialize;
use tauri::State;

use super::AppContext;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgRoutine {
    /// `pg_proc.oid`, carried as i64 because JSON has no unsigned 32-bit type. It is
    /// the handle the source read takes — a name is ambiguous under overloading.
    pub oid: i64,
    pub schema: String,
    pub name: String,
    /// The argument list as Postgres renders it, e.g. `a integer, b text DEFAULT 'x'`.
    /// Empty for a routine that takes none.
    pub arguments: String,
    /// None for a procedure: procedures return nothing, and "void" would be a lie.
    pub return_type: Option<String>,
    /// "function" or "procedure". Aggregates ('a') and window functions ('w') are
    /// left out of the listing rather than mislabelled — `pg_get_functiondef` cannot
    /// render them, so including them would offer a source read that always fails.
    pub kind: String,
    pub language: String,
}

fn kind_of(prokind: &str) -> &'static str {
    if prokind == "p" {
        "procedure"
    } else {
        "function"
    }
}

pub(crate) async fn list_routines_impl(
    pool: &sqlx::PgPool,
    schema: Option<&str>,
) -> Result<Vec<PgRoutine>, AppError> {
    // `pg_proc` is world-readable, so this works for a role that owns nothing. The
    // schema filter is a bind parameter rather than spliced SQL: NULL means "every
    // schema a user would browse", which is every non-system one.
    let rows: Vec<(i64, String, String, String, Option<String>, String, String)> = match sqlx::query_as(
        "SELECT p.oid::bigint, n.nspname, p.proname, \
                pg_get_function_arguments(p.oid), \
                CASE WHEN p.prokind = 'p' THEN NULL ELSE pg_get_function_result(p.oid) END, \
                p.prokind::text, l.lanname \
         FROM pg_proc p \
         JOIN pg_namespace n ON n.oid = p.pronamespace \
         JOIN pg_language l ON l.oid = p.prolang \
         WHERE p.prokind IN ('f', 'p') \
           AND ($1::text IS NULL OR n.nspname = $1) \
           AND ($1::text IS NOT NULL OR (n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%')) \
         ORDER BY n.nspname, p.proname, pg_get_function_arguments(p.oid)",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    Ok(rows
        .into_iter()
        .map(|(oid, schema, name, arguments, return_type, prokind, language)| PgRoutine {
            oid,
            schema,
            name,
            arguments,
            return_type,
            kind: String::from(kind_of(&prokind)),
            language,
        })
        .collect())
}

pub(crate) async fn routine_source_impl(pool: &sqlx::PgPool, oid: i64) -> Result<String, AppError> {
    // pg_get_functiondef renders the whole CREATE statement — arguments, volatility,
    // language and body — rather than this reconstructing one from pg_proc's columns
    // and getting an edge case wrong.
    let row: Option<(String,)> = match sqlx::query_as("SELECT pg_get_functiondef($1::oid)")
        .bind(oid)
        .fetch_optional(pool)
        .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    match row {
        Some((source,)) => Ok(source),
        None => Err(AppError::Validation(String::from(
            "That function no longer exists; refresh the list.",
        ))),
    }
}

/// Every function and procedure a role may see, in one schema or in all the user
/// ones. Read-only: editing is `CREATE OR REPLACE` in a SQL tab, which already works.
#[tauri::command]
pub async fn pg_routines(
    ctx: State<'_, AppContext>,
    id: String,
    schema: Option<String>,
) -> Result<Vec<PgRoutine>, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    list_routines_impl(&pool, schema.as_deref()).await
}

/// One routine's `CREATE` statement, as Postgres renders it.
#[tauri::command]
pub async fn pg_routine_source(
    ctx: State<'_, AppContext>,
    id: String,
    oid: i64,
) -> Result<String, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    routine_source_impl(&pool, oid).await
}

#[cfg(test)]
#[path = "routines.test.rs"]
mod tests;
