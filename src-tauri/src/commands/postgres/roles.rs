use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::AppContext;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgRole {
    pub name: String,
    pub can_login: bool,
    pub superuser: bool,
    pub create_role: bool,
    pub create_db: bool,
    pub replication: bool,
    pub bypass_rls: bool,
    /// -1 means no limit, which is Postgres's own default — reported as it stands
    /// rather than turned into 0, which would read as "no connections allowed".
    pub connection_limit: i32,
    /// When the password expires, as text. None for a role whose password never does.
    pub valid_until: Option<String>,
    /// The roles this one is a member of, in name order. Membership is a graph, not
    /// MongoDB's flat per-database assignment list, so it is reported per role and
    /// only in this direction — who a role grants to is the same edges read the
    /// other way, which the frontend can derive.
    pub member_of: Vec<String>,
    /// Postgres's own predefined roles (`pg_read_all_stats`, `pg_monitor`, …).
    /// Flagged rather than filtered, the way `is_system_schema` flags a schema, so
    /// the frontend decides whether to show them.
    pub system: bool,
}

/// What `create_pg_role` takes. Deliberately the common case only: a named role,
/// optionally able to log in with a password, plus the three attributes anyone
/// setting up a database account reaches for. Per-object GRANT/REVOKE is a
/// different and much larger surface, tracked separately.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPgRole {
    pub name: String,
    pub password: Option<String>,
    pub can_login: bool,
    pub superuser: bool,
    pub create_db: bool,
    pub create_role: bool,
}

pub(crate) async fn list_roles_impl(pool: &sqlx::PgPool) -> Result<Vec<PgRole>, AppError> {
    // `pg_roles` is a view over `pg_authid` with the password hashes blanked out, and
    // it is readable by every role — unlike `pg_authid` itself, and unlike the
    // information_schema views whose privilege filtering broke the primary-key lookup
    // this codebase already had to fix once.
    let rows: Vec<(String, bool, bool, bool, bool, bool, bool, i32, Option<String>, Option<Vec<String>>)> =
        match sqlx::query_as(
            "SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolcreatedb, \
                    r.rolreplication, r.rolbypassrls, r.rolconnlimit, r.rolvaliduntil::text, \
                    (SELECT array_agg(g.rolname ORDER BY g.rolname) \
                       FROM pg_auth_members m \
                       JOIN pg_roles g ON g.oid = m.roleid \
                      WHERE m.member = r.oid) \
             FROM pg_roles r ORDER BY r.rolname",
        )
        .fetch_all(pool)
        .await
        {
            Ok(val) => val,
            Err(e) => return Err(AppError::Postgres(e)),
        };
    Ok(rows
        .into_iter()
        .map(|(name, can_login, superuser, create_role, create_db, replication, bypass_rls, connection_limit, valid_until, member_of)| {
            PgRole {
                system: name.starts_with("pg_"),
                name,
                can_login,
                superuser,
                create_role,
                create_db,
                replication,
                bypass_rls,
                connection_limit,
                valid_until,
                member_of: member_of.unwrap_or_default(),
            }
        })
        .collect())
}

// Postgres accepts no bind parameters in DDL, so the statement text has to carry the
// role's name and password. Rather than escaping them here, the server is asked to
// build the statement with `format`: `%I` quotes an identifier and `%L` a literal, by
// the same rules the server itself parses. The values travel as binds on that SELECT,
// so nothing user-supplied is ever spliced into SQL text by us.
async fn execute_built(pool: &sqlx::PgPool, sql: String) -> Result<(), AppError> {
    match sqlx::query(sqlx::AssertSqlSafe(sql)).execute(pool).await {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::Postgres(e)),
    }
}

pub(crate) async fn create_role_impl(pool: &sqlx::PgPool, role: &NewPgRole) -> Result<(), AppError> {
    if role.name.trim().is_empty() {
        return Err(AppError::Validation(String::from("A role needs a name.")));
    }
    // Fixed keywords chosen from flags — no user input reaches this string. Every
    // attribute is stated either way round so the role never silently inherits a
    // server default that differs from what the form showed.
    let attributes = format!(
        "{} {} {} {}",
        if role.can_login { "LOGIN" } else { "NOLOGIN" },
        if role.superuser { "SUPERUSER" } else { "NOSUPERUSER" },
        if role.create_db { "CREATEDB" } else { "NOCREATEDB" },
        if role.create_role { "CREATEROLE" } else { "NOCREATEROLE" },
    );
    // `%L` of NULL renders as the keyword NULL, and `PASSWORD NULL` is Postgres's own
    // way of saying "no password", so one statement covers both cases.
    let sql: String = match sqlx::query_scalar(
        "SELECT format('CREATE ROLE %I WITH %s PASSWORD %L', $1, $2, $3)",
    )
    .bind(&role.name)
    .bind(&attributes)
    .bind(role.password.as_deref())
    .fetch_one(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    execute_built(pool, sql).await
}

pub(crate) async fn drop_role_impl(pool: &sqlx::PgPool, name: &str) -> Result<(), AppError> {
    // Postgres refuses to drop a role that still owns objects or holds privileges,
    // with a detail naming them. That error is surfaced as it stands: reassigning or
    // dropping what it owns is a decision for whoever is looking, not for this.
    let sql: String = match sqlx::query_scalar("SELECT format('DROP ROLE %I', $1)")
        .bind(name)
        .fetch_one(pool)
        .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    execute_built(pool, sql).await
}

/// Every role on the server with its cluster-level attributes and the roles it
/// belongs to. Read-only, and readable by any role.
#[tauri::command]
pub async fn pg_roles(ctx: State<'_, AppContext>, id: String) -> Result<Vec<PgRole>, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    list_roles_impl(&pool).await
}

/// Create a role. Refused on a read-only connection, like every other write.
#[tauri::command]
pub async fn create_pg_role(ctx: State<'_, AppContext>, id: String, role: NewPgRole) -> Result<(), AppError> {
    let pool = ctx.pg_pool_for_write(&id).await?;
    create_role_impl(&pool, &role).await
}

/// Drop a role. Refused on a read-only connection.
#[tauri::command]
pub async fn drop_pg_role(ctx: State<'_, AppContext>, id: String, name: String) -> Result<(), AppError> {
    let pool = ctx.pg_pool_for_write(&id).await?;
    drop_role_impl(&pool, &name).await
}
