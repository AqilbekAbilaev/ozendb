// Whether this install can replace itself in place.
//
// The Tauri updater only knows how to swap the bundle it shipped as, and on Linux that
// means AppImage — a `.deb` or `.rpm` install belongs to the package manager, and asking
// the updater to replace it fails at install time, well after the user has agreed to it.
// The frontend asks first so those installs are pointed at the downloads page instead of
// being promised something that can't happen.
//
// AppImage runtimes export `APPIMAGE` (the path of the mounted image) into the process
// environment, which is the only reliable runtime signal for "we are an AppImage".

/// True when an update can be installed in place: always on macOS and Windows, and on
/// Linux only when running as an AppImage.
#[tauri::command]
pub fn can_self_update() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE").is_some()
    } else {
        true
    }
}

#[cfg(test)]
#[path = "updater.test.rs"]
mod tests;
