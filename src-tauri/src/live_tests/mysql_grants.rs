//! Live tests of granting and revoking a MySQL account's privileges, against the server
//! `mysql.rs` describes.

use super::mysql::{test_config, SKIP};
use super::mysql_browse::pool;
use super::mysql_users::create_account;
use crate::commands::{mysql_change_privileges, mysql_drop_user, mysql_grants, MySqlPrivilegeChange};

const USER: &str = r"ozendb it grants o'brien \ ü";

fn change(database: Option<&str>, privileges: &[&str], grant_option: bool) -> MySqlPrivilegeChange {
    MySqlPrivilegeChange {
        user: String::from(USER),
        host: String::from("%"),
        database: database.map(String::from),
        table: None,
        privileges: privileges.iter().map(|p| p.to_string()).collect(),
        grant_option,
    }
}

#[tokio::test]
async fn privileges_are_granted_and_revoked_on_the_server_and_on_an_awkwardly_named_database() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool(&config).await;
    create_account(&pool, USER).await;
    let database = "ozendb it `grants` ü";

    mysql_change_privileges(&pool, &change(Some(database), &["SELECT", "INSERT"], true), true).await.unwrap();
    mysql_change_privileges(&pool, &change(None, &["PROCESS"], false), true).await.unwrap();
    let grants = mysql_grants(&pool, USER, "%").await.unwrap();
    assert!(grants.iter().any(|g| g.starts_with("GRANT PROCESS ON *.*")), "{grants:?}");
    assert!(grants.iter().any(|g| g.starts_with("GRANT SELECT, INSERT ON `ozendb it ``grants`` ü`.*") && g.ends_with("WITH GRANT OPTION")), "{grants:?}");

    mysql_change_privileges(&pool, &change(Some(database), &["SELECT", "INSERT"], true), false).await.unwrap();
    let grants = mysql_grants(&pool, USER, "%").await.unwrap();
    assert!(!grants.iter().any(|g| g.contains("`ozendb it ``grants`` ü`")), "revoking with the grant option leaves nothing on the database: {grants:?}");

    mysql_drop_user(&pool, USER, "%").await.unwrap();
}
