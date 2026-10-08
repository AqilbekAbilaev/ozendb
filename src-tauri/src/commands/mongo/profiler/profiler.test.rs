use super::profile_command;

#[test]
fn level_off_builds_command() {
    let cmd = profile_command(0, 100).unwrap();
    assert_eq!(cmd.get_i32("profile").unwrap(), 0);
    assert_eq!(cmd.get_i32("slowms").unwrap(), 100);
}

#[test]
fn level_slow_ops_builds_command() {
    let cmd = profile_command(1, 50).unwrap();
    assert_eq!(cmd.get_i32("profile").unwrap(), 1);
    assert_eq!(cmd.get_i32("slowms").unwrap(), 50);
}

#[test]
fn level_all_builds_command() {
    let cmd = profile_command(2, 0).unwrap();
    assert_eq!(cmd.get_i32("profile").unwrap(), 2);
}

#[test]
fn out_of_range_level_errors() {
    assert!(profile_command(3, 100).is_err());
    assert!(profile_command(-1, 100).is_err());
}
