use super::*;

// One test rather than two: both cases mutate the same process-wide environment, so
// splitting them would let cargo's parallel runner interleave the set and the remove.
#[test]
#[cfg(target_os = "linux")]
fn linux_can_only_self_update_as_an_appimage() {
    std::env::remove_var("APPIMAGE");
    assert!(!can_self_update(), "a deb/rpm install must not offer an in-place update");

    std::env::set_var("APPIMAGE", "/tmp/OzenDB.AppImage");
    assert!(can_self_update(), "an AppImage install updates in place");

    std::env::remove_var("APPIMAGE");
}

#[test]
#[cfg(not(target_os = "linux"))]
fn other_platforms_always_self_update() {
    assert!(can_self_update());
}
