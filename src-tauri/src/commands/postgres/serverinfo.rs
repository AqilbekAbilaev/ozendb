use crate::error::AppError;
use serde::Serialize;
use tauri::State;

use super::AppContext;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgExtension {
    pub name: String,
    pub version: String,
    pub schema: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgServerInfo {
    /// The full banner, as `SELECT version()` gives it — build and platform included.
    pub version: String,
    pub server_version: String,
    /// The parseable form: 160009 for 16.9. Kept alongside the string because the
    /// string carries betas and distribution suffixes that no comparison should parse.
    pub server_version_num: i32,
    /// Postmaster start time as text; uptime is the frontend's subtraction to make,
    /// since only it knows what "now" the user is looking at.
    pub started_at: String,
    pub database: String,
    pub database_size_bytes: i64,
    pub connections: i64,
    pub max_connections: i64,
    pub extensions: Vec<PgExtension>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgSetting {
    pub name: String,
    pub setting: String,
    /// None rather than an empty string for a setting that measures nothing, so the
    /// viewer shows a blank cell rather than a stray unit.
    pub unit: Option<String>,
    pub short_desc: Option<String>,
    /// Where the value came from: "default", "configuration file", "override"…
    pub source: String,
    pub source_file: Option<String>,
    /// A change is staged that only a restart will apply.
    pub pending_restart: bool,
}

pub(crate) async fn server_info_impl(pool: &sqlx::PgPool) -> Result<PgServerInfo, AppError> {
    // One round trip for the summary: every value here is a scalar the server already
    // holds, so splitting them over several queries would only cost latency.
    let row: (String, String, String, String, String, i64, i64, i64) = match sqlx::query_as(
        "SELECT version(), \
                current_setting('server_version'), \
                current_setting('server_version_num'), \
                pg_postmaster_start_time()::text, \
                current_database(), \
                pg_database_size(current_database()), \
                (SELECT count(*) FROM pg_stat_activity), \
                current_setting('max_connections')::bigint",
    )
    .fetch_one(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };

    let extensions: Vec<(String, String, String)> = match sqlx::query_as(
        "SELECT e.extname, e.extversion, n.nspname \
         FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace \
         ORDER BY e.extname",
    )
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };

    let (version, server_version, version_num, started_at, database, size, connections, max_connections) = row;
    Ok(PgServerInfo {
        version,
        server_version,
        // current_setting returns text for every setting; the numeric form is the one
        // worth comparing, so it is parsed here rather than in every caller.
        server_version_num: version_num.parse().unwrap_or(0),
        started_at,
        database,
        database_size_bytes: size,
        connections,
        max_connections,
        extensions: extensions
            .into_iter()
            .map(|(name, version, schema)| PgExtension { name, version, schema })
            .collect(),
    })
}

pub(crate) async fn server_settings_impl(pool: &sqlx::PgPool) -> Result<Vec<PgSetting>, AppError> {
    // `pg_settings` shows a non-superuser every setting it may see and silently omits
    // the rest, so this needs no privilege check of its own — the view is the check.
    let rows: Vec<(String, String, Option<String>, Option<String>, String, Option<String>, bool)> =
        match sqlx::query_as(
            "SELECT name, setting, unit, short_desc, source, sourcefile, pending_restart \
             FROM pg_settings ORDER BY name",
        )
        .fetch_all(pool)
        .await
        {
            Ok(val) => val,
            Err(e) => return Err(AppError::Postgres(e)),
        };
    Ok(rows
        .into_iter()
        .map(|(name, setting, unit, short_desc, source, source_file, pending_restart)| PgSetting {
            name,
            setting,
            unit,
            short_desc,
            source,
            source_file,
            pending_restart,
        })
        .collect())
}

/// Version, uptime, size and installed extensions — the Postgres sibling of
/// MongoDB's Server Info. Read-only: this reports settings, it never sets them.
#[tauri::command]
pub async fn pg_server_info(ctx: State<'_, AppContext>, id: String) -> Result<PgServerInfo, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    server_info_impl(&pool).await
}

/// Every setting this role may see, with where it came from and whether a change to
/// it is waiting on a restart.
#[tauri::command]
pub async fn pg_server_settings(ctx: State<'_, AppContext>, id: String) -> Result<Vec<PgSetting>, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    server_settings_impl(&pool).await
}
