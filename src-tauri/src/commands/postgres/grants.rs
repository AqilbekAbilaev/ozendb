//! "What can this role touch" (ozendb-ahy, split out of ozendb-5kp's cluster-level
//! role management), plus GRANT/REVOKE on the same objects it lists: schemas, the
//! table-like relations and sequences, with `WITH GRANT OPTION` and `CASCADE`.
//! Still out of scope: `ALTER DEFAULT PRIVILEGES`, ownership, row-level security,
//! column-level grants, and functions/types/foreign servers/large objects.
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
use serde::{Deserialize, Serialize};
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

/// One GRANT or REVOKE: `privileges` on one object, to or from `role`. `object` is
/// None for a schema. `grant_option` only applies to a grant, `cascade` to a revoke.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PgPrivilegeChange {
    pub role: String,
    pub object_kind: String,
    pub schema: String,
    pub object: Option<String>,
    pub privileges: Vec<String>,
    #[serde(default)]
    pub grant_option: bool,
    #[serde(default)]
    pub cascade: bool,
}

const RELATION_PRIVILEGES: &[&str] = &["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

/// The privileges each grantable kind takes, in the order statements list them, and the
/// keyword its ON clause uses. Views and the other relations take `ON TABLE`.
fn kind_rules(kind: &str) -> Option<(&'static [&'static str], &'static str)> {
    match kind {
        "schema" => Some((&["USAGE", "CREATE"], "SCHEMA")),
        "table" | "view" | "matview" | "partitioned_table" | "foreign_table" => Some((RELATION_PRIVILEGES, "TABLE")),
        "sequence" => Some((&["USAGE", "SELECT", "UPDATE"], "SEQUENCE")),
        _ => None,
    }
}

/// The statement as a `format()` template: keywords come only from the lists above, so
/// nothing user-supplied is spliced in, and every name is left as a `%I` for the server
/// to quote — schema, then object (relations only), then role.
pub(crate) fn statement_template(change: &PgPrivilegeChange, grant: bool) -> Result<String, AppError> {
    let (allowed, keyword) = match kind_rules(&change.object_kind) {
        Some(val) => val,
        None => return Err(AppError::Validation(format!("Privileges can't be granted on a {} here.", change.object_kind))),
    };
    if change.role.trim().is_empty() || change.schema.trim().is_empty() {
        return Err(AppError::Validation(String::from("Choose a role and a schema.")));
    }
    let is_schema = keyword == "SCHEMA";
    if !is_schema && change.object.as_deref().map(str::trim).unwrap_or("").is_empty() {
        return Err(AppError::Validation(String::from("Choose the object to grant on.")));
    }
    let wanted: Vec<String> = change.privileges.iter().map(|p| p.trim().to_uppercase()).collect();
    if wanted.is_empty() {
        return Err(AppError::Validation(String::from("Choose at least one privilege.")));
    }
    if let Some(bad) = wanted.iter().find(|p| !allowed.contains(&p.as_str())) {
        return Err(AppError::Validation(format!("{bad} doesn't apply to a {}.", change.object_kind)));
    }
    let privileges: Vec<&str> = allowed.iter().copied().filter(|p| wanted.iter().any(|w| w == p)).collect();
    let target = if is_schema { "%I" } else { "%I.%I" };
    let list = privileges.join(", ");
    Ok(if grant {
        let option = if change.grant_option { " WITH GRANT OPTION" } else { "" };
        format!("GRANT {list} ON {keyword} {target} TO %I{option}")
    } else {
        let behaviour = if change.cascade { "CASCADE" } else { "RESTRICT" };
        format!("REVOKE {list} ON {keyword} {target} FROM %I {behaviour}")
    })
}

// Postgres takes no bind parameters in DDL, so the server builds the final text with
// `format`, the way roles.rs builds CREATE ROLE: the names travel as binds.
pub(crate) async fn change_privileges_impl(pool: &sqlx::PgPool, change: &PgPrivilegeChange, grant: bool) -> Result<(), AppError> {
    let template = statement_template(change, grant)?;
    let built = match change.object.as_deref().filter(|_| change.object_kind != "schema") {
        Some(object) => sqlx::query_scalar("SELECT format($1, $2, $3, $4)")
            .bind(&template).bind(&change.schema).bind(object).bind(&change.role)
            .fetch_one(pool).await,
        None => sqlx::query_scalar("SELECT format($1, $2, $3)")
            .bind(&template).bind(&change.schema).bind(&change.role)
            .fetch_one(pool).await,
    };
    let sql: String = match built {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    match sqlx::query(sqlx::AssertSqlSafe(sql)).execute(pool).await {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::Postgres(e)),
    }
}

/// Every object `role` holds a direct privilege on, across schemas and relations.
#[tauri::command]
pub async fn list_pg_grants(ctx: State<'_, AppContext>, id: String, role: String) -> Result<Vec<PgGrant>, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    list_grants_impl(&pool, &role).await
}

/// Grant privileges on one object. Refused on a read-only connection.
#[tauri::command]
pub async fn grant_pg_privileges(ctx: State<'_, AppContext>, id: String, change: PgPrivilegeChange) -> Result<(), AppError> {
    let pool = ctx.pg_pool_for_write(&id).await?;
    change_privileges_impl(&pool, &change, true).await
}

/// Revoke privileges on one object. Refused on a read-only connection.
#[tauri::command]
pub async fn revoke_pg_privileges(ctx: State<'_, AppContext>, id: String, change: PgPrivilegeChange) -> Result<(), AppError> {
    let pool = ctx.pg_pool_for_write(&id).await?;
    change_privileges_impl(&pool, &change, false).await
}

#[cfg(test)]
#[path = "grants.test.rs"]
mod tests;
