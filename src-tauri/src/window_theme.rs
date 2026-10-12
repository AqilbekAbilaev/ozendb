//! The OS-level half of the app theme. Native title bars follow the window's theme rather
//! than the page, so every window is given the app's theme explicitly (#274).

use tauri::window::Color;
use tauri::Theme;

/// Anything but "light" is dark, as `normalizedTheme` does in the frontend.
pub fn window_theme(theme: &str) -> Theme {
    match theme {
        "light" => Theme::Light,
        _ => Theme::Dark,
    }
}

/// What a new window shows before its page paints: theme.css's `--bg-window`.
pub fn window_background(theme: &str) -> Color {
    match window_theme(theme) {
        Theme::Light => Color(244, 245, 247, 255),
        _ => Color(31, 32, 35, 255),
    }
}

#[cfg(test)]
#[path = "window_theme.test.rs"]
mod tests;
