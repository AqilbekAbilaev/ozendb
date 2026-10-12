use super::*;

#[test]
fn a_light_theme_asks_the_os_for_light_windows() {
    assert_eq!(window_theme("light"), Theme::Light);
}

#[test]
fn a_dark_theme_asks_the_os_for_dark_windows() {
    assert_eq!(window_theme("dark"), Theme::Dark);
}

#[test]
fn an_unknown_theme_falls_back_to_dark_windows_like_the_ui_does() {
    assert_eq!(window_theme("Solarized ü"), Theme::Dark);
}

#[test]
fn the_window_background_is_the_light_bg_window_token() {
    assert_eq!(window_background("light"), Color(244, 245, 247, 255));
}

#[test]
fn the_window_background_is_the_dark_bg_window_token() {
    assert_eq!(window_background("dark"), Color(31, 32, 35, 255));
}

fn hex(Color(r, g, b, _): Color) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn read(relative: &str) -> String {
    std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(relative)).unwrap()
}

// theme.css declares the dark tokens first (:root), then the light ones.
#[test]
fn the_backgrounds_match_theme_css() {
    let css = read("../src/assets/theme.css");
    let tokens: Vec<&str> = css
        .lines()
        .filter_map(|line| line.trim().strip_prefix("--bg-window:"))
        .map(|value| value.trim().trim_end_matches(';'))
        .collect();
    assert_eq!(tokens, [hex(window_background("dark")), hex(window_background("light"))]);
}

#[test]
fn the_document_page_pre_paints_the_same_backgrounds() {
    let html = read("../src/pages/document.html");
    for theme in ["dark", "light"] {
        let colour = hex(window_background(theme));
        assert!(html.contains(&colour), "document.html never paints {colour}");
    }
}
