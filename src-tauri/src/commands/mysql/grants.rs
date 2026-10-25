//! GRANT/REVOKE of the static privileges at the three levels most work needs: the whole
//! server, one database, one table. Column, routine and proxy grants, and granting a
//! role, are left to the SQL tab; SHOW GRANTS (users.rs) still lists them.
use crate::error::AppError;
use serde::Deserialize;
use sqlx::MySqlPool;
use tauri::State;

use super::users::execute;
use super::{quote_account, quote_name, AppContext};

/// One GRANT or REVOKE of `privileges` to or from `user`@`host`. No `database` means the
/// whole server, and a `database` with no `table` every table in it. `grant_option`
/// grants the option with them, or revokes it with them.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MySqlPrivilegeChange {
    pub user: String,
    pub host: String,
    pub database: Option<String>,
    pub table: Option<String>,
    pub privileges: Vec<String>,
    #[serde(default)]
    pub grant_option: bool,
}

/// Each level's own privileges, in the order statements list them; a level takes the ones
/// below it too. engines/mysql/admin/grantRows.js offers the same lists.
const TABLE_PRIVILEGES: &[&str] = &[
    "SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "REFERENCES", "INDEX", "ALTER", "CREATE VIEW", "SHOW VIEW", "TRIGGER",
];
const DATABASE_PRIVILEGES: &[&str] = &["CREATE TEMPORARY TABLES", "LOCK TABLES", "EXECUTE", "CREATE ROUTINE", "ALTER ROUTINE", "EVENT"];
const SERVER_PRIVILEGES: &[&str] = &[
    "PROCESS", "RELOAD", "SHOW DATABASES", "REPLICATION CLIENT", "REPLICATION SLAVE", "CREATE USER", "CREATE ROLE", "DROP ROLE",
    "FILE", "SHUTDOWN", "CREATE TABLESPACE",
];

/// The statement for `change`: keywords come only from the lists above, and every name
/// is quoted, so nothing chosen in the form is spliced in as it stands.
fn privilege_statement(change: &MySqlPrivilegeChange, grant: bool) -> Result<String, AppError> {
    let (target, level, levels) = match (&change.database, &change.table) {
        (None, None) => (String::from("*.*"), "server", 3),
        (Some(database), None) => (format!("{}.*", quote_name(database)?), "database", 2),
        (Some(database), Some(table)) => (format!("{}.{}", quote_name(database)?, quote_name(table)?), "table", 1),
        (None, Some(_)) => return Err(AppError::Validation(String::from("Name the database the table is in."))),
    };
    let allowed: Vec<&str> = [TABLE_PRIVILEGES, DATABASE_PRIVILEGES, SERVER_PRIVILEGES][..levels].concat();
    let wanted: Vec<String> = change.privileges.iter().map(|p| p.trim().to_uppercase()).collect();
    if wanted.is_empty() {
        return Err(AppError::Validation(String::from("Choose at least one privilege.")));
    }
    if let Some(bad) = wanted.iter().find(|p| !allowed.contains(&p.as_str())) {
        return Err(AppError::Validation(format!("{bad} doesn't apply to a {level}.")));
    }
    let mut privileges: Vec<&str> = allowed.into_iter().filter(|p| wanted.iter().any(|w| w == p)).collect();
    let account = quote_account(&change.user, &change.host);
    Ok(if grant {
        let option = if change.grant_option { " WITH GRANT OPTION" } else { "" };
        format!("GRANT {} ON {target} TO {account}{option}", privileges.join(", "))
    } else {
        if change.grant_option {
            privileges.push("GRANT OPTION");
        }
        format!("REVOKE {} ON {target} FROM {account}", privileges.join(", "))
    })
}

pub(crate) async fn mysql_change_privileges(pool: &MySqlPool, change: &MySqlPrivilegeChange, grant: bool) -> Result<(), AppError> {
    execute(pool, privilege_statement(change, grant)?).await
}

/// Grant privileges at one level. Refused on a read-only connection.
#[tauri::command]
pub async fn grant_mysql_privileges(ctx: State<'_, AppContext>, id: String, change: MySqlPrivilegeChange) -> Result<(), AppError> {
    mysql_change_privileges(&ctx.mysql_pool_for_write(&id, None).await?, &change, true).await
}

/// Revoke privileges at one level. Refused on a read-only connection.
#[tauri::command]
pub async fn revoke_mysql_privileges(ctx: State<'_, AppContext>, id: String, change: MySqlPrivilegeChange) -> Result<(), AppError> {
    mysql_change_privileges(&ctx.mysql_pool_for_write(&id, None).await?, &change, false).await
}

#[cfg(test)]
#[path = "grants.test.rs"]
mod tests;
