//! Live-PostgreSQL coverage of the read-only diagnostics reads (`server_info_impl`,
//! `server_settings_impl`). Shares `pg.rs`'s helpers and skip
//! behaviour; see its module doc comment for how to run these.

use crate::commands::{server_info_impl, server_settings_impl};
use super::pg::{pool, test_config};

#[tokio::test]
async fn server_info_reports_version_uptime_and_size() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let info = server_info_impl(&pool).await.expect("server info");

    assert!(info.version.starts_with("PostgreSQL"), "version string: {}", info.version);
    // `server_version_num` is the parseable one: 160009 for 16.9, and every supported
    // server is at least 10.0.
    assert!(info.server_version_num >= 100_000, "version num: {}", info.server_version_num);
    assert!(!info.server_version.is_empty());
    assert!(!info.started_at.is_empty(), "no postmaster start time");
    assert!(!info.database.is_empty(), "no current database");
    assert!(info.database_size_bytes > 0, "database size: {}", info.database_size_bytes);
    // This test's own session is connected, so there is at least one.
    assert!(info.connections >= 1, "connections: {}", info.connections);
    assert!(
        info.max_connections >= info.connections,
        "max {} below current {}",
        info.max_connections,
        info.connections,
    );
}

#[tokio::test]
async fn extensions_include_the_one_every_database_has() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let info = server_info_impl(&pool).await.expect("server info");
    // plpgsql is installed in every database created from the standard template.
    let plpgsql = info.extensions.iter().find(|e| e.name == "plpgsql").expect("plpgsql listed");
    assert!(!plpgsql.version.is_empty(), "extension with no version");
    assert!(!plpgsql.schema.is_empty(), "extension with no schema");
}

#[tokio::test]
async fn settings_carry_their_source_and_restart_flag() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let settings = server_settings_impl(&pool).await.expect("settings");

    assert!(settings.len() > 100, "only {} settings read", settings.len());
    let max_connections = settings
        .iter()
        .find(|s| s.name == "max_connections")
        .expect("max_connections is always present");
    assert!(!max_connections.setting.is_empty());
    assert!(!max_connections.source.is_empty(), "no source for max_connections");
    // Changing it needs a restart, so the flag exists even when nothing is pending.
    assert!(!max_connections.pending_restart, "nothing was changed, so nothing is pending");

    // The order is the server's own collation (which sorts "DateStyle" among the d's
    // and ignores the underscore in "lo_compat_privileges"), so what the viewer needs
    // pinned is that it doesn't move between reads — not that it matches Rust's
    // byte ordering, which it deliberately doesn't.
    let again = server_settings_impl(&pool).await.expect("settings, again");
    assert_eq!(
        settings.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        again.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        "two reads disagreed on the order",
    );
}

#[tokio::test]
async fn a_unit_less_setting_reports_no_unit_rather_than_an_empty_one() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let settings = server_settings_impl(&pool).await.expect("settings");
    // `shared_buffers` is measured in 8kB blocks; `server_version` has no unit at all.
    let version = settings.iter().find(|s| s.name == "server_version").expect("server_version");
    assert_eq!(version.unit, None);
    let buffers = settings.iter().find(|s| s.name == "shared_buffers").expect("shared_buffers");
    assert!(buffers.unit.is_some(), "shared_buffers reported no unit");
}
