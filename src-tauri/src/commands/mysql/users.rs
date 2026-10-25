//! The server's accounts, each a user at a host, read from `mysql.user`, with what each
//! may do as SHOW GRANTS states it, and creating or dropping one. MySQL takes no bound value in an account statement, so names and the
//! password are quoted as strings (`quote_account`) rather than bound.
use crate::error::{mysql_number, AppError};
use serde::{Deserialize, Serialize};
use sqlx::{MySqlPool, Row};
use tauri::State;

use super::{quote_account, quote_string, AppContext};

/// MySQL's "SELECT command denied" for a table, here `mysql.user`.
const TABLE_ACCESS_DENIED: u16 = 1142;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlUser {
    pub user: String,
    pub host: String,
    /// How it signs in: `caching_sha2_password`, `mysql_native_password`, `auth_socket`…
    pub plugin: String,
    /// A role is an account too, created locked with an expired password.
    pub locked: bool,
    pub password_expired: bool,
    /// MySQL's own reserved accounts (`mysql.sys`, `mysql.session`, `mysql.infoschema`),
    /// flagged rather than filtered so the frontend decides whether to show them.
    pub system: bool,
    /// The account this connection signed in as, which may not drop itself.
    pub current: bool,
}

/// What `create_mysql_user` takes: the common case only, as PostgreSQL's role form is.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMySqlUser {
    pub user: String,
    pub host: String,
    pub password: Option<String>,
}

pub(crate) async fn mysql_users(pool: &MySqlPool) -> Result<Vec<MySqlUser>, AppError> {
    let rows: Vec<(String, String, String, bool, bool, bool)> = sqlx::query_as(
        "SELECT User, Host, plugin, account_locked = 'Y', password_expired = 'Y', CONCAT(User, '@', Host) = CURRENT_USER() \
         FROM mysql.user ORDER BY User, Host",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| match mysql_number(&e) {
        Some(TABLE_ACCESS_DENIED) => AppError::Forbidden(String::from(
            "MySQL doesn't show this login the server's accounts: listing them needs SELECT on mysql.user.",
        )),
        _ => AppError::MySql(e),
    })?;
    Ok(rows
        .into_iter()
        .map(|(user, host, plugin, locked, password_expired, current)| MySqlUser {
            system: user.starts_with("mysql."),
            user,
            host,
            plugin,
            locked,
            password_expired,
            current,
        })
        .collect())
}

/// The GRANT statements that recreate the account's privileges, its roles among them.
pub(crate) async fn mysql_grants(pool: &MySqlPool, user: &str, host: &str) -> Result<Vec<String>, AppError> {
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!("SHOW GRANTS FOR {}", quote_account(user, host))))
        .fetch_all(pool)
        .await
        .map_err(AppError::MySql)?;
    rows.iter().map(|row| row.try_get(0).map_err(AppError::MySql)).collect()
}

fn create_statement(new: &NewMySqlUser) -> Result<String, AppError> {
    if new.user.trim().is_empty() || new.host.trim().is_empty() {
        return Err(AppError::Validation(String::from("An account needs a user name and a host.")));
    }
    let account = quote_account(&new.user, &new.host);
    Ok(match &new.password {
        Some(password) => format!("CREATE USER {account} IDENTIFIED BY {}", quote_string(password)),
        None => format!("CREATE USER {account}"),
    })
}

pub(super) async fn execute(pool: &MySqlPool, statement: String) -> Result<(), AppError> {
    sqlx::raw_sql(sqlx::AssertSqlSafe(statement)).execute(pool).await.map(drop).map_err(AppError::MySql)
}

pub(crate) async fn mysql_create_user(pool: &MySqlPool, new: &NewMySqlUser) -> Result<(), AppError> {
    execute(pool, create_statement(new)?).await
}

pub(crate) async fn mysql_drop_user(pool: &MySqlPool, user: &str, host: &str) -> Result<(), AppError> {
    execute(pool, format!("DROP USER {}", quote_account(user, host))).await
}

/// Every account on the server. Read-only, and only for a login that may read mysql.user.
#[tauri::command]
pub async fn list_mysql_users(ctx: State<'_, AppContext>, id: String) -> Result<Vec<MySqlUser>, AppError> {
    mysql_users(&ctx.mysql_pool(&id, None).await?).await
}

/// What the account may do, its roles among it.
#[tauri::command]
pub async fn list_mysql_grants(ctx: State<'_, AppContext>, id: String, user: String, host: String) -> Result<Vec<String>, AppError> {
    mysql_grants(&ctx.mysql_pool(&id, None).await?, &user, &host).await
}

/// Create an account. Refused on a read-only connection, like every other write.
#[tauri::command]
pub async fn create_mysql_user(ctx: State<'_, AppContext>, id: String, user: NewMySqlUser) -> Result<(), AppError> {
    mysql_create_user(&ctx.mysql_pool_for_write(&id, None).await?, &user).await
}

/// Drop an account. Refused on a read-only connection.
#[tauri::command]
pub async fn drop_mysql_user(ctx: State<'_, AppContext>, id: String, user: String, host: String) -> Result<(), AppError> {
    mysql_drop_user(&ctx.mysql_pool_for_write(&id, None).await?, &user, &host).await
}

#[cfg(test)]
#[path = "users.test.rs"]
mod tests;
