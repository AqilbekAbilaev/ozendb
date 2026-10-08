use super::{is_write_action, menus_for, Gate, MenuScope, Spec};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Wry,
};

// Managed state: the gated items, their gate, and whether they are write actions
// (so `set_menu_context` can also disable them under the read-only lock), plus the
// scope the live menu was built for, so a rebuild happens only when it changes, and
// the items carrying an accelerator, which a rebuild clears first (see
// `clear_accelerators`).
pub struct MenuItems(pub Mutex<MenuState>);

pub struct MenuState {
    pub scope: MenuScope,
    pub gated: Vec<(MenuItem<Wry>, Gate, bool)>,
    pub accelerated: Vec<MenuItem<Wry>>,
}

// What `build` hands back: the menu, plus the item handles `MenuState` keeps.
pub struct BuiltMenu {
    pub menu: Menu<Wry>,
    pub gated: Vec<(MenuItem<Wry>, Gate, bool)>,
    pub accelerated: Vec<MenuItem<Wry>>,
}

// muda 0.19 on GTK removes an item's accelerator a second time when its menu is
// destroyed, and GTK prints "no accelerator installed in accel group" for each one
// (#174) — once per engine switch, since that rebuilds the menu. Clearing them while
// the old menu is still attached leaves the destroy path nothing to remove twice.
pub fn clear_accelerators(items: &[MenuItem<Wry>]) {
    for item in items.iter() {
        let _ = item.set_accelerator(None::<&str>);
    }
}

// Whether native accelerators should be attached. On Linux/WebKitGTK, registering
// accelerators (especially the predefined clipboard ones) makes the menu swallow
// keys like Ctrl+C/V/X/A and our editor combos before the webview can act on them,
// which breaks text editing — so on Linux the frontend keeps its own JS keyboard
// handling and we attach no accelerators here.
fn accelerators_enabled() -> bool {
    !cfg!(target_os = "linux")
}

// Appends one submenu's specs, collecting gated item handles into `gated` and the
// ones given an accelerator into `accelerated`.
fn build_submenu(
    app: &AppHandle,
    name: &str,
    specs: &[Spec],
    overrides: &HashMap<String, String>,
    gated: &mut Vec<(MenuItem<Wry>, Gate, bool)>,
    accelerated: &mut Vec<MenuItem<Wry>>,
) -> tauri::Result<Submenu<Wry>> {
    let submenu = Submenu::new(app, name, true)?;

    // The Edit menu also carries the standard clipboard/undo items so the webview
    // gets working OS shortcuts — but only where they don't trip the WebKitGTK
    // swallow trap (see `accelerators_enabled`).
    if name == "Edit" && accelerators_enabled() {
        let clipboard = edit_clipboard_items(app)?;
        for predefined in clipboard.iter() {
            submenu.append(predefined)?;
        }
        let separator = PredefinedMenuItem::separator(app)?;
        submenu.append(&separator)?;
    }

    for spec in specs.iter() {
        match spec {
            Spec::Separator => {
                let separator = PredefinedMenuItem::separator(app)?;
                submenu.append(&separator)?;
            }
            Spec::Placeholder { id, label } => {
                let item = MenuItem::with_id(app, *id, *label, false, None::<&str>)?;
                submenu.append(&item)?;
            }
            Spec::Action { id, label, accel, gate } => {
                // On macOS the app menu's predefined Quit already owns ⌘Q, so the
                // File → Exit item must not register it a second time.
                let is_mac_exit = cfg!(target_os = "macos") && *id == "file:exit";
                // A user rebind (overrides) wins over the built-in default; fall
                // back to the static accel when the id isn't customized. Owned so
                // the string outlives this closure.
                let effective: Option<String> = match overrides.get(*id) {
                    Some(custom) => Some(custom.clone()),
                    None => accel.map(|a| a.to_string()),
                };
                // Tab-navigation items register their accelerators even on Linux so
                // GTK handles Ctrl+Tab / Ctrl+Shift+Tab before WebKitGTK can swallow
                // the key. Clipboard/editing items (Edit menu) still skip accelerators
                // on Linux to avoid the WebKitGTK swallow trap.
                let is_tab_nav = *id == "view:next_tab" || *id == "view:prev_tab";
                let accelerator = if (accelerators_enabled() || is_tab_nav) && !is_mac_exit {
                    effective.as_deref()
                } else {
                    None
                };
                // Gated items start disabled; the frontend pushes the real context
                // right after load. Always-on items (gate: None) start enabled.
                let enabled = gate.is_none();
                let item = MenuItem::with_id(app, *id, *label, enabled, accelerator)?;
                submenu.append(&item)?;
                if let Some(gate_value) = gate {
                    gated.push((item.clone(), *gate_value, is_write_action(id)));
                }
                if accelerator.is_some() {
                    accelerated.push(item.clone());
                }
            }
        }
    }

    Ok(submenu)
}

// The predefined undo/redo/cut/copy/paste/select-all items for the Edit menu.
fn edit_clipboard_items(app: &AppHandle) -> tauri::Result<Vec<PredefinedMenuItem<Wry>>> {
    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    Ok(vec![undo, redo, separator, cut, copy, paste, select_all])
}

// The macOS application menu (the first submenu, which macOS renders under the app
// name): About, Preferences…, Services, Hide/Hide Others/Show All, Quit.
#[cfg(target_os = "macos")]
fn build_app_menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let about = match PredefinedMenuItem::about(app, None, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let separator_about = match PredefinedMenuItem::separator(app) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    // Same id as the Edit item so it routes to the same handler; no accelerator
    // here to avoid registering the combo twice.
    let preferences = match MenuItem::with_id(app, "edit:preferences", "Preferences…", true, None::<&str>) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let separator_prefs = match PredefinedMenuItem::separator(app) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let services = match PredefinedMenuItem::services(app, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let separator_services = match PredefinedMenuItem::separator(app) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let hide = match PredefinedMenuItem::hide(app, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let hide_others = match PredefinedMenuItem::hide_others(app, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let show_all = match PredefinedMenuItem::show_all(app, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let separator_quit = match PredefinedMenuItem::separator(app) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let quit = match PredefinedMenuItem::quit(app, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    Submenu::with_items(
        app,
        "OzenDB",
        true,
        &[
            &about,
            &separator_about,
            &preferences,
            &separator_prefs,
            &services,
            &separator_services,
            &hide,
            &hide_others,
            &show_all,
            &separator_quit,
            &quit,
        ],
    )
}

// Builds the full native menu and returns it together with the gated item handles
// (for later enable/disable updates) and the accelerated ones.
pub fn build(
    app: &AppHandle,
    overrides: &HashMap<String, String>,
    scope: MenuScope,
) -> tauri::Result<BuiltMenu> {
    let menu = Menu::new(app)?;
    let mut gated: Vec<(MenuItem<Wry>, Gate, bool)> = Vec::new();
    let mut accelerated: Vec<MenuItem<Wry>> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        let app_menu = match build_app_menu(app) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
        match menu.append(&app_menu) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
    }

    for (name, specs) in menus_for(scope).iter() {
        let submenu = build_submenu(app, name, specs, overrides, &mut gated, &mut accelerated)?;
        menu.append(&submenu)?;
    }

    Ok(BuiltMenu { menu, gated, accelerated })
}

// Attaches a built menu. Shared by startup and the per-engine rebuild.
pub fn install(app: &AppHandle, menu: Menu<Wry>) -> Result<(), String> {
    // `WebviewWindow::set_menu` is a documented no-op on macOS (its own docs:
    // "Unsupported... use AppHandle::set_menu instead") — it returns Ok without
    // ever attaching anything, silently leaving the OS's bare default menu in
    // place. macOS has one shared system menu bar regardless of which window is
    // frontmost, so app-wide is the only model there anyway — no risk of a
    // pop-out document window getting its own menu, unlike Windows/Linux.
    #[cfg(target_os = "macos")]
    match app.set_menu(menu) {
        Ok(_val) => {}
        Err(e) => return Err(e.to_string()),
    };
    // Scope the menu to the main window so the pop-out document windows
    // don't get their own native menu bar.
    #[cfg(not(target_os = "macos"))]
    {
        use tauri::Manager;
        let main_window = match app.get_webview_window("main") {
            Some(val) => val,
            None => return Err("no main window to attach the menu to".to_string()),
        };
        match main_window.set_menu(menu) {
            Ok(_val) => {}
            Err(e) => return Err(e.to_string()),
        };
    }
    Ok(())
}
