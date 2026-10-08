use super::info_command;

#[test]
fn maps_build_to_build_info() {
    let cmd = info_command("build").unwrap();
    assert!(cmd.contains_key("buildInfo"));
}

#[test]
fn maps_host_to_host_info() {
    let cmd = info_command("host").unwrap();
    assert!(cmd.contains_key("hostInfo"));
}

#[test]
fn maps_replica_to_repl_set_get_status() {
    let cmd = info_command("replica").unwrap();
    assert!(cmd.contains_key("replSetGetStatus"));
}

#[test]
fn unknown_kind_errors() {
    assert!(info_command("bogus").is_err());
}
