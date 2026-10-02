//! A read-only "what can this role touch" view (ozendb-ahy, split out of ozendb-5kp's
//! cluster-level role management, which deliberately stopped at role attributes and
//! membership). Per-object GRANT/REVOKE is a much larger surface — object kinds,
//! `WITH GRANT OPTION`, `ALTER DEFAULT PRIVILEGES`, ownership, row-level security —
//! and this view alone is "most of the value and none of the risk" of that surface,
//! so editing privileges stays out of scope here.
//!
//! Reads go through `pg_catalog` and `aclexplode()` over `relacl`/`nspacl` directly,
//! not `information_schema.role_table_grants`: that view only shows grants on
//! objects the *connected* role owns or holds a privilege on, so a role browsing
//! another role's grants (or a read-only login) sees an incomplete picture — the
//! same privilege-filtering trap `primary_key_columns`' own doc comment already
//! named once for a different `information_schema` view.
//!
//! Scoped to *direct* grants only — a role's privileges inherited through group
//! membership aren't resolved here, the same direct-edges-only scope `list_roles_impl`
//! already gives `member_of` (the transitive closure is real but separate work).
use crate::error::AppError;
use serde::Serialize;
use tauri::State;

use super::AppContext;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PgGrant {
    /// "schema", "table", "view", "matview", "sequence", "partitioned_table" or
    /// "foreign_table" — `pg_class.relkind` spelled out, or "schema" for a
    /// `pg_namespace` row (which has no `object` name of its own).
    pub object_kind: String,
    pub schema: String,
    pub object: Option<String>,
    pub privilege: String,
    pub grantable: bool,
}

fn relkind_name(kind: &str) -> &'static str {
    match kind {
        "r" => "table",
        "v" => "view",
        "m" => "matview",
        "S" => "sequence",
        "p" => "partitioned_table",
        "f" => "foreign_table",
        _ => "relation",
    }
}

/// Every table/view/sequence (etc.) `role` holds a direct privilege on, by way of
/// `aclexplode` over each relation's own ACL — falling back to `acldefault('r', …)`
/// for a relation nobody has ever run GRANT/REVOKE on, so the owner's implicit full
/// privileges still show up rather than reading as "this role can touch nothing".
async fn relation_grants(pool: &sqlx::PgPool, role: &str) -> Result<Vec<PgGrant>, AppError> {
    let rows: Vec<(String, String, String, String, bool)> = match sqlx::query_as(
        "SELECT n.nspname, c.relname, c.relkind::text, a.privilege_type, a.is_grantable \
         FROM pg_class c \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a \
         JOIN pg_roles r ON r.oid = a.grantee \
         WHERE r.rolname = $1 AND c.relkind IN ('r', 'v', 'm', 'S', 'p', 'f') \
         ORDER BY n.nspname, c.relname, a.privilege_type",
    )
    .bind(role)
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    Ok(rows
        .into_iter()
        .map(|(schema, relname, relkind, privilege, grantable)| PgGrant {
            object_kind: relkind_name(&relkind).to_string(),
            schema,
            object: Some(relname),
            privilege,
            grantable,
        })
        .collect())
}

/// Every schema `role` holds a direct privilege on (USAGE/CREATE), the same
/// `acldefault` fallback as `relation_grants` for a schema nobody has GRANT/REVOKEd.
async fn schema_grants(pool: &sqlx::PgPool, role: &str) -> Result<Vec<PgGrant>, AppError> {
    let rows: Vec<(String, String, bool)> = match sqlx::query_as(
        "SELECT n.nspname, a.privilege_type, a.is_grantable \
         FROM pg_namespace n \
         CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a \
         JOIN pg_roles r ON r.oid = a.grantee \
         WHERE r.rolname = $1 \
         ORDER BY n.nspname, a.privilege_type",
    )
    .bind(role)
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    Ok(rows
        .into_iter()
        .map(|(schema, privilege, grantable)| PgGrant {
            object_kind: String::from("schema"),
            schema,
            object: None,
            privilege,
            grantable,
        })
        .collect())
}

pub(crate) async fn list_grants_impl(pool: &sqlx::PgPool, role: &str) -> Result<Vec<PgGrant>, AppError> {
    let mut grants = schema_grants(pool, role).await?;
    grants.extend(relation_grants(pool, role).await?);
    Ok(grants)
}

/// Read-only: every object `role` holds a direct privilege on, across schemas and
/// relations. See this module's own doc comment for what's deliberately left out.
#[tauri::command]
pub async fn list_pg_grants(ctx: State<'_, AppContext>, id: String, role: String) -> Result<Vec<PgGrant>, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    list_grants_impl(&pool, &role).await
}
