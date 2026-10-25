//! Live tests of MySQL's accounts and the grants they hold, against the server `mysql.rs`
//! describes.

use super::mysql::{connect, run, test_config, SKIP};
use super::mysql_browse::pool;
use crate::commands::{mysql_create_user, mysql_drop_user, mysql_grants, mysql_users, NewMySqlUser};
use crate::mysql::uri::build_options;
use crate::storage::ConnectionConfig;
use sqlx::MySqlPool;

/// A pool signed in as `user`, who has the password `password`.
pub(super) async fn pool_as(config: &ConnectionConfig, user: &str, password: &str) -> MySqlPool {
    let as_user = ConnectionConfig { username: Some(String::from(user)), ..config.clone() };
    MySqlPool::connect_with(build_options(&as_user, Some(password), "", None).unwrap()).await.unwrap()
}

/// A password with a quote, a backslash and a non-ASCII letter in it.
pub(super) const PASSWORD: &str = r"pa'ss\word ü";

/// `user`@`%`, made afresh with `PASSWORD`; the caller drops it.
pub(super) async fn create_account(pool: &MySqlPool, user: &str) {
    let _ = mysql_drop_user(pool, user, "%").await;
    let new = NewMySqlUser { user: String::from(user), host: String::from("%"), password: Some(String::from(PASSWORD)) };
    mysql_create_user(pool, &new).await.unwrap();
}

#[tokio::test]
async fn an_awkwardly_named_account_is_created_listed_and_dropped_under_its_own_name() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let user = r"ozendb it o'brien \ ü";
    let pool = pool(&config).await;
    create_account(&pool, user).await;

    let users = mysql_users(&pool).await.unwrap();
    let created = users.iter().find(|u| u.user == user).expect("the new account is listed under its own name");
    assert_eq!((created.host.as_str(), created.locked, created.system, created.current), ("%", false, false, false));
    assert!(users.iter().any(|u| u.user == "mysql.sys" && u.system), "MySQL's reserved accounts are flagged");
    assert_eq!(users.iter().filter(|u| u.current).count(), 1, "exactly one account is the one signed in");
    pool_as(&config, user, PASSWORD).await.close().await;
    assert_eq!(mysql_grants(&pool, user, "%").await.unwrap(), [r"GRANT USAGE ON *.* TO `ozendb it o'brien \ ü`@`%`"]);

    mysql_drop_user(&pool, user, "%").await.unwrap();
    assert!(!mysql_users(&pool).await.unwrap().iter().any(|u| u.user == user));
}

#[tokio::test]
async fn a_login_that_may_not_read_mysql_user_is_told_so() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let (user, password) = ("ozendb_it_users_low", "low ü");
    let mut admin = connect(&config, "").await;
    run(&mut admin, &format!("DROP USER IF EXISTS '{user}'@'%'")).await;
    run(&mut admin, &format!("CREATE USER '{user}'@'%' IDENTIFIED BY '{password}'")).await;
    let low = pool_as(&config, user, password).await;

    let refused = mysql_users(&low).await.err().unwrap();
    assert_eq!(refused.code(), "forbidden");
    assert!(refused.to_string().contains("needs SELECT on mysql.user"), "{refused}");

    low.close().await;
    run(&mut admin, &format!("DROP USER '{user}'@'%'")).await;
}
