use super::*;

fn with_theme(theme: &str) -> Settings {
    Settings { theme: theme.to_string(), ..Settings::default() }
}

#[test]
fn a_light_theme_asks_the_os_for_light_windows() {
    assert_eq!(with_theme("light").window_theme(), Theme::Light);
}

#[test]
fn a_dark_theme_asks_the_os_for_dark_windows() {
    assert_eq!(with_theme("dark").window_theme(), Theme::Dark);
}

#[test]
fn an_unknown_theme_falls_back_to_dark_windows_like_the_ui_does() {
    assert_eq!(with_theme("Solarized ü").window_theme(), Theme::Dark);
}

#[test]
fn the_window_background_matches_the_light_bg_window_token() {
    assert_eq!(with_theme("light").window_background(), Color(244, 245, 247, 255));
}

#[test]
fn the_window_background_matches_the_dark_bg_window_token() {
    assert_eq!(with_theme("dark").window_background(), Color(31, 32, 35, 255));
}
