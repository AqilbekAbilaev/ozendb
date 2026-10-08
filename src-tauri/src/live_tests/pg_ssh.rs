//! Live coverage of a PostgreSQL connection through an SSH tunnel, with the tunnel's
//! trust-on-first-use host-key policy, against a real OpenSSH server. The prompt goes
//! through Tauri's mock runtime, so no app is launched. Needs:
//!   OZENDB_TEST_SSH=host:port          the bastion
//!   OZENDB_TEST_SSH_USER / _PASSWORD   password login on it
//!   OZENDB_TEST_SSH_TARGET=host:port   PostgreSQL as the bastion sees it
//!   OZENDB_TEST_POSTGRES_PASSWORD      the `postgres` user's password

use crate::commands::run_query_as;
use crate::known_hosts::KnownHostsStore;
use crate::postgres::uri::build_options_to;
use crate::ssh::{establish, HostKeyPrompts, SshAuth, SshParams};
use crate::storage::{ConnectionConfig, EngineConfig, PostgresConfig};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::Listener;

struct Bastion {
    host: String,
    port: u16,
    user: String,
    password: String,
    target: (String, u16),
}

fn host_port(value: &str) -> (String, u16) {
    let (host, port) = value.rsplit_once(':').expect("host:port");
    (host.to_string(), port.parse().expect("a port number"))
}

fn bastion() -> Option<Bastion> {
    let (host, port) = host_port(&std::env::var("OZENDB_TEST_SSH").ok()?);
    Some(Bastion {
        host,
        port,
        user: std::env::var("OZENDB_TEST_SSH_USER").ok()?,
        password: std::env::var("OZENDB_TEST_SSH_PASSWORD").ok()?,
        target: host_port(&std::env::var("OZENDB_TEST_SSH_TARGET").ok()?),
    })
}

fn params(b: &Bastion) -> SshParams {
    SshParams {
        ssh_host: b.host.clone(),
        ssh_port: b.port,
        ssh_user: b.user.clone(),
        auth: SshAuth::Password(b.password.clone()),
        mongo_host: b.target.0.clone(),
        mongo_port: b.target.1,
    }
}

#[tokio::test]
async fn a_postgres_connection_runs_through_the_tunnel_trusting_its_host_key_once() {
    let Some(b) = bastion() else {
        eprintln!("skipping: set OZENDB_TEST_SSH, _USER, _PASSWORD and _TARGET to run the tunnel test");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let known = Arc::new(KnownHostsStore::new(dir.path().join("known_hosts.json")));
    let prompts = Arc::new(HostKeyPrompts::new());
    let app = tauri::test::mock_app();
    let asked = Arc::new(AtomicUsize::new(0));
    let trust = Arc::new(AtomicBool::new(false));
    {
        let (prompts, asked, trust) = (Arc::clone(&prompts), Arc::clone(&asked), Arc::clone(&trust));
        app.listen("ssh-host-key-prompt", move |event| {
            asked.fetch_add(1, Ordering::SeqCst);
            let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
            prompts.resolve(payload["requestId"].as_u64().unwrap(), trust.load(Ordering::SeqCst));
        });
    }
    let open = || establish(params(&b), Arc::clone(&known), Arc::clone(&prompts), app.handle().clone());

    // Declining the first-contact prompt refuses the tunnel and trusts nothing.
    let declined = open().await.err().expect("an untrusted host is refused");
    assert!(declined.to_string().contains("not trusted"), "{declined}");
    assert!(known.stored_key(&b.host, b.port).is_none());

    // Trusting it opens the tunnel, and PostgreSQL answers through it.
    trust.store(true, Ordering::SeqCst);
    let tunnel = open().await.expect("a trusted host opens a tunnel");
    let config = ConnectionConfig {
        username: Some(String::from("postgres")),
        engine: EngineConfig::Postgres(PostgresConfig::default()),
        ..Default::default()
    };
    let password = std::env::var("OZENDB_TEST_POSTGRES_PASSWORD").ok();
    let options = build_options_to(&config, &PostgresConfig::default(), password.as_deref(), "127.0.0.1", tunnel.local_addr.port()).unwrap();
    let pool = sqlx::PgPool::connect_with(options).await.expect("PostgreSQL reached through the tunnel");
    let result = run_query_as(&pool, "SELECT 40 + 2", false, None).await.unwrap();
    assert_eq!(result.rows, vec![vec![serde_json::json!(42)]]);
    pool.close().await;
    drop(tunnel);

    // Coming back to a known, unchanged host asks nothing.
    let asked_so_far = asked.load(Ordering::SeqCst);
    let again = open().await.expect("a known host reconnects");
    assert_eq!(asked.load(Ordering::SeqCst), asked_so_far);
    drop(again);

    // A host whose key has changed is refused outright, without a prompt.
    known.remove(&b.host, b.port).unwrap();
    known.record(&b.host, b.port, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHN0b3JlZCBrZXkgdGhhdCBubyBsb25nZXIgbWF0Y2hlcw").unwrap();
    let changed = open().await.err().expect("a changed host key is refused");
    assert!(changed.to_string().contains("does not match"), "{changed}");
    assert_eq!(asked.load(Ordering::SeqCst), asked_so_far);
}
