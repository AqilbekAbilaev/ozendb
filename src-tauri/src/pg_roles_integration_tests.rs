//! Live-PostgreSQL coverage of role browsing and management (`list_roles_impl`,
//! `create_role_impl`, `drop_role_impl`). Shares `pg_integration_tests.rs`'s helpers
//! and skip behaviour; see its module doc comment for how to run these.

use crate::commands::{
    change_privileges_impl, create_role_impl, drop_role_impl, list_grants_impl, list_roles_impl, NewPgRole,
    PgPrivilegeChange,
};
use crate::pg_integration_tests::{pool, test_config};
use sqlx::Connection;

fn role(name: &str) -> NewPgRole {
    NewPgRole {
        name: name.to_string(),
        password: None,
        can_login: false,
        superuser: false,
        create_db: false,
        create_role: false,
    }
}

async fn drop_if_exists(pool: &sqlx::PgPool, names: &[&str]) {
    for name in names {
        sqlx::query(sqlx::AssertSqlSafe(format!("DROP ROLE IF EXISTS \"{name}\"")))
            .execute(pool)
            .await
            .ok();
    }
}

#[tokio::test]
async fn lists_roles_with_their_attributes() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let roles = list_roles_impl(&pool).await.expect("roles");

    // The role we are connected as is in the list, and it is the test superuser.
    let me = roles.iter().find(|r| r.name == "postgres").expect("the postgres role");
    assert!(me.superuser, "the connecting role is not reported as a superuser");
    assert!(me.can_login);
    // -1 is Postgres's "no limit"; it must be reported, not turned into 0.
    assert_eq!(me.connection_limit, -1);

    // Postgres's own predefined roles are flagged rather than filtered, the way
    // is_system_schema flags a schema — the frontend decides whether to show them.
    let predefined = roles.iter().find(|r| r.name == "pg_read_all_stats").expect("a predefined role");
    assert!(predefined.system, "pg_read_all_stats is not flagged as a system role");
    assert!(!predefined.can_login, "a predefined role should not be able to log in");
    assert!(!me.system, "the postgres role was flagged as a system role");
}

#[tokio::test]
async fn membership_is_visible_not_just_a_flat_list() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let (group, member) = ("ozendb_it_group", "ozendb_it_member");
    drop_if_exists(&pool, &[member, group]).await;

    create_role_impl(&pool, &role(group)).await.expect("create the group");
    create_role_impl(&pool, &role(member)).await.expect("create the member");
    sqlx::query(sqlx::AssertSqlSafe(format!("GRANT \"{group}\" TO \"{member}\"")))
        .execute(&pool)
        .await
        .expect("grant");

    let roles = list_roles_impl(&pool).await.expect("roles");
    let found = roles.iter().find(|r| r.name == member).expect("the member role");
    assert_eq!(found.member_of, vec![group.to_string()]);
    // Membership is one-directional: the group is not a member of its member.
    let group_row = roles.iter().find(|r| r.name == group).expect("the group role");
    assert!(group_row.member_of.is_empty(), "membership was reported both ways");

    drop_if_exists(&pool, &[member, group]).await;
}

#[tokio::test]
async fn a_login_role_can_be_created_and_then_used() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let name = "ozendb_it_login";
    drop_if_exists(&pool, &[name]).await;

    // A password with a quote and a backslash in it: the DDL is quoted by Postgres
    // itself (format %L), so this must be stored verbatim rather than escaping into
    // the statement text.
    let password = "p'a\\ss\"word";
    create_role_impl(&pool, &NewPgRole {
        name: name.to_string(),
        password: Some(password.to_string()),
        can_login: true,
        superuser: false,
        create_db: false,
        create_role: false,
    })
    .await
    .expect("create the login role");

    let roles = list_roles_impl(&pool).await.expect("roles");
    let created = roles.iter().find(|r| r.name == name).expect("the new role");
    assert!(created.can_login);
    assert!(!created.superuser);
    assert!(!created.system);

    // The acceptance case: a plain login role, no superuser and no pg_read_all_stats,
    // must still be able to read the role list — the privilege-filtering trap that
    // information_schema fell into for primary keys.
    let host = &config.hosts[0];
    let options = sqlx::postgres::PgConnectOptions::new()
        .host(&host.host)
        .port(host.port)
        .username(name)
        .password(password)
        .database("postgres");
    let mut plain = sqlx::PgConnection::connect_with(&options).await.expect("connect as the new role");
    let as_plain: i64 = sqlx::query_scalar("SELECT count(*) FROM pg_roles")
        .fetch_one(&mut plain)
        .await
        .expect("a plain role may read pg_roles");
    assert!(as_plain > 0, "a plain login role saw no roles at all");
    plain.close().await.ok();

    drop_if_exists(&pool, &[name]).await;
}

#[tokio::test]
async fn dropping_a_role_removes_it() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let name = "ozendb_it_doomed";
    drop_if_exists(&pool, &[name]).await;

    create_role_impl(&pool, &role(name)).await.expect("create");
    assert!(list_roles_impl(&pool).await.expect("roles").iter().any(|r| r.name == name));

    drop_role_impl(&pool, name).await.expect("drop");
    assert!(!list_roles_impl(&pool).await.expect("roles").iter().any(|r| r.name == name));
}

#[tokio::test]
async fn a_role_that_owns_something_cannot_be_dropped_silently() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let name = "ozendb_it_owner";
    drop_if_exists(&pool, &[name]).await;
    sqlx::query(sqlx::AssertSqlSafe(String::from("DROP TABLE IF EXISTS public.ozendb_it_owned")))
        .execute(&pool)
        .await
        .ok();

    create_role_impl(&pool, &role(name)).await.expect("create");
    for stmt in [
        String::from("CREATE TABLE public.ozendb_it_owned (id int)"),
        format!("ALTER TABLE public.ozendb_it_owned OWNER TO \"{name}\""),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(stmt)).execute(&pool).await.expect("setup");
    }

    // Postgres refuses; the command must surface that rather than reporting success.
    let refused = drop_role_impl(&pool, name).await;
    assert!(refused.is_err(), "dropping a role that owns a table reported success");

    sqlx::query(sqlx::AssertSqlSafe(String::from("DROP TABLE public.ozendb_it_owned")))
        .execute(&pool)
        .await
        .ok();
    drop_if_exists(&pool, &[name]).await;
}

#[tokio::test]
async fn a_role_name_is_quoted_not_spliced() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    // A name that would end the identifier and start a new statement if it were
    // spliced into the DDL rather than quoted by Postgres.
    let hostile = "ozendb_it\"; DROP TABLE public.users; --";
    drop_if_exists(&pool, &[hostile]).await;

    create_role_impl(&pool, &role(hostile)).await.expect("create the awkward role");
    let roles = list_roles_impl(&pool).await.expect("roles");
    assert!(roles.iter().any(|r| r.name == hostile), "the role was not created under its own name");

    drop_role_impl(&pool, hostile).await.expect("drop the awkward role");
    assert!(!list_roles_impl(&pool).await.expect("roles").iter().any(|r| r.name == hostile));
}

#[tokio::test]
async fn lists_direct_grants_including_the_owners_implicit_ones() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let name = "ozendb_it_grantee";
    drop_if_exists(&pool, &[name]).await;
    create_role_impl(&pool, &role(name)).await.expect("create the test role");

    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_grants CASCADE".to_string(),
        "CREATE SCHEMA ozendb_it_grants".to_string(),
        "CREATE TABLE ozendb_it_grants.widgets (id int)".to_string(),
        format!("GRANT USAGE ON SCHEMA ozendb_it_grants TO \"{name}\""),
        format!("GRANT SELECT, UPDATE ON ozendb_it_grants.widgets TO \"{name}\""),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(stmt)).execute(&pool).await.expect("setup");
    }

    let grants = list_grants_impl(&pool, name).await.expect("grants");
    assert!(
        grants.iter().any(|g| g.object_kind == "schema" && g.schema == "ozendb_it_grants" && g.privilege == "USAGE"),
        "missing the schema USAGE grant: {grants:?}",
    );
    assert!(
        grants.iter().any(|g| g.object_kind == "table"
            && g.schema == "ozendb_it_grants"
            && g.object.as_deref() == Some("widgets")
            && g.privilege == "SELECT"),
        "missing the table SELECT grant: {grants:?}",
    );
    assert!(grants.iter().any(|g| g.privilege == "UPDATE"), "missing the table UPDATE grant: {grants:?}");

    // A role nobody has granted anything to still sees nothing — no implicit entries
    // leak in for an unrelated role.
    let other = "ozendb_it_grantee_bystander";
    drop_if_exists(&pool, &[other]).await;
    create_role_impl(&pool, &role(other)).await.expect("create the bystander role");
    let bystander_grants = list_grants_impl(&pool, other).await.expect("grants");
    assert!(
        !bystander_grants.iter().any(|g| g.schema == "ozendb_it_grants"),
        "a role with no grant must not see another role's: {bystander_grants:?}",
    );

    sqlx::query(sqlx::AssertSqlSafe(String::from("DROP SCHEMA ozendb_it_grants CASCADE"))).execute(&pool).await.ok();
    drop_if_exists(&pool, &[name, other]).await;
}

fn privilege_change(role: &str, kind: &str, object: Option<&str>, privileges: &[&str]) -> PgPrivilegeChange {
    PgPrivilegeChange {
        role: role.to_string(),
        object_kind: kind.to_string(),
        schema: String::from("ozendb_it_grant_edit"),
        object: object.map(String::from),
        privileges: privileges.iter().map(|p| p.to_string()).collect(),
        grant_option: false,
        cascade: false,
    }
}

fn holds(grants: &[crate::commands::PgGrant], object: Option<&str>, privilege: &str) -> Option<bool> {
    grants
        .iter()
        .find(|g| g.schema == "ozendb_it_grant_edit" && g.object.as_deref() == object && g.privilege == privilege)
        .map(|g| g.grantable)
}

// #141: GRANT and REVOKE round-trip through what list_grants_impl reports.
#[tokio::test]
async fn grants_and_revokes_privileges_on_schemas_tables_and_sequences() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    // A name that needs quoting proves the identifiers go through %I, not splicing.
    let name = "ozendb it \"grant\" edit";
    sqlx::query(sqlx::AssertSqlSafe(String::from("DROP SCHEMA IF EXISTS ozendb_it_grant_edit CASCADE"))).execute(&pool).await.ok();
    drop_quoted_role(&pool, name).await;
    create_role_impl(&pool, &role(name)).await.expect("create the grantee");
    for stmt in [
        "CREATE SCHEMA ozendb_it_grant_edit",
        "CREATE TABLE ozendb_it_grant_edit.orders (id serial PRIMARY KEY)",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(String::from(stmt))).execute(&pool).await.expect("setup");
    }

    let mut on_table = privilege_change(name, "table", Some("orders"), &["SELECT", "INSERT"]);
    on_table.grant_option = true;
    change_privileges_impl(&pool, &on_table, true).await.expect("grant on the table");
    change_privileges_impl(&pool, &privilege_change(name, "schema", None, &["USAGE"]), true).await.expect("grant on the schema");
    change_privileges_impl(&pool, &privilege_change(name, "sequence", Some("orders_id_seq"), &["USAGE"]), true)
        .await
        .expect("grant on the sequence");

    let grants = list_grants_impl(&pool, name).await.expect("grants");
    assert_eq!(holds(&grants, Some("orders"), "SELECT"), Some(true), "SELECT WITH GRANT OPTION: {grants:?}");
    assert_eq!(holds(&grants, Some("orders"), "INSERT"), Some(true), "{grants:?}");
    assert_eq!(holds(&grants, None, "USAGE"), Some(false), "schema USAGE: {grants:?}");
    assert_eq!(holds(&grants, Some("orders_id_seq"), "USAGE"), Some(false), "sequence USAGE: {grants:?}");

    change_privileges_impl(&pool, &privilege_change(name, "table", Some("orders"), &["INSERT"]), false)
        .await
        .expect("revoke INSERT");
    change_privileges_impl(&pool, &privilege_change(name, "schema", None, &["USAGE"]), false).await.expect("revoke USAGE");
    let after = list_grants_impl(&pool, name).await.expect("grants");
    assert_eq!(holds(&after, Some("orders"), "INSERT"), None, "INSERT should be gone: {after:?}");
    assert_eq!(holds(&after, Some("orders"), "SELECT"), Some(true), "SELECT must survive: {after:?}");
    assert_eq!(holds(&after, None, "USAGE"), None, "schema USAGE should be gone: {after:?}");

    // A privilege the kind lacks is refused before anything reaches the server.
    let refused = change_privileges_impl(&pool, &privilege_change(name, "sequence", Some("orders_id_seq"), &["DELETE"]), true).await;
    assert!(matches!(refused, Err(crate::error::AppError::Validation(_))), "{refused:?}");

    sqlx::query(sqlx::AssertSqlSafe(String::from("DROP SCHEMA ozendb_it_grant_edit CASCADE"))).execute(&pool).await.ok();
    drop_quoted_role(&pool, name).await;
}

// drop_if_exists splices the name, which a role name containing a quote can't survive.
async fn drop_quoted_role(pool: &sqlx::PgPool, name: &str) {
    if let Ok(drop) = sqlx::query_scalar::<_, String>("SELECT format('DROP ROLE IF EXISTS %I', $1)").bind(name).fetch_one(pool).await {
        sqlx::query(sqlx::AssertSqlSafe(drop)).execute(pool).await.ok();
    }
}
