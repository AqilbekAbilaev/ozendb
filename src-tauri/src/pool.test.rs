use super::{default_port_for, mongo_config, postgres_config, tunnel_params};
use crate::ssh::SshAuth;
use crate::storage::{ConnectionConfig, Engine, EngineConfig, HostEntry, MongoConfig, MySqlConfig, PostgresConfig};

fn config(engine: Engine) -> ConnectionConfig {
    ConnectionConfig {
        id: String::from("1"),
        name: String::from("test"),
        engine: match engine {
            Engine::Mongo => EngineConfig::Mongo(MongoConfig::default()),
            Engine::Postgres => EngineConfig::Postgres(PostgresConfig::default()),
            Engine::MySql => EngineConfig::MySql(MySqlConfig::default()),
        },
        ..Default::default()
    }
}

#[test]
fn mongo_config_passes_mongo_and_rejects_postgres() {
    assert!(mongo_config(&config(Engine::Mongo)).is_ok());
    assert_eq!(mongo_config(&config(Engine::Postgres)).unwrap_err().code(), "validation");
    assert_eq!(mongo_config(&config(Engine::MySql)).unwrap_err().code(), "validation");
}

#[test]
fn postgres_config_passes_postgres_and_rejects_mongo() {
    assert!(postgres_config(&config(Engine::Postgres)).is_ok());
    assert_eq!(postgres_config(&config(Engine::Mongo)).unwrap_err().code(), "validation");
    assert_eq!(postgres_config(&config(Engine::MySql)).unwrap_err().code(), "validation");
}

#[test]
fn default_port_for_matches_the_configs_own_engine() {
    assert_eq!(default_port_for(&config(Engine::Mongo)), 27017);
    assert_eq!(default_port_for(&config(Engine::Postgres)), 5432);
    assert_eq!(default_port_for(&config(Engine::MySql)), 3306);
}

#[test]
fn tunnel_params_forwards_to_the_first_host_with_password_auth() {
    let mut cfg = config(Engine::Postgres);
    cfg.hosts = vec![
        HostEntry { host: String::from("db1"), port: 6543 },
        HostEntry { host: String::from("db2"), port: 6544 },
    ];
    cfg.ssh_host = Some(String::from("bastion"));
    cfg.ssh_port = 2222;
    cfg.ssh_user = Some(String::from("me"));
    cfg.ssh_auth = Some(String::from("password"));

    let params = tunnel_params(&cfg, Some(String::from("pw")), None);

    assert_eq!((params.ssh_host.as_str(), params.ssh_port, params.ssh_user.as_str()), ("bastion", 2222, "me"));
    assert_eq!((params.mongo_host.as_str(), params.mongo_port), ("db1", 6543));
    assert!(matches!(params.auth, SshAuth::Password(ref pw) if pw == "pw"));
}

#[test]
fn tunnel_params_uses_the_key_file_and_passphrase_for_key_auth() {
    let mut cfg = config(Engine::Mongo);
    cfg.ssh_auth = Some(String::from("key"));
    cfg.ssh_key_file = Some(String::from("/k"));

    let params = tunnel_params(&cfg, Some(String::from("ignored")), Some(String::from("pp")));

    assert!(matches!(params.auth, SshAuth::Key { ref path, ref passphrase }
        if path == "/k" && passphrase.as_deref() == Some("pp")));
}

#[test]
fn tunnel_params_falls_back_to_the_engines_default_port_without_hosts() {
    let params = tunnel_params(&config(Engine::Postgres), None, None);
    assert_eq!((params.mongo_host.as_str(), params.mongo_port), ("localhost", 5432));
}
