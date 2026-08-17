use super::{is_write_action, menus, Gate, Spec};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Wry,
};

// Managed state: the gated items, their gate, and whether they are write actions
// (so `set_menu_context` can also disable them under the read-only lock).
pub struct MenuItems(pub Mutex<Vec<(MenuItem<Wry>, Gate, bool)>>);

// Whether native accelerators should be attached. On Linux/WebKitGTK, registering
// accelerators (especially the predefined clipboard ones) makes the menu swallow
// keys like Ctrl+C/V/X/A and our editor combos before the webview can act on them,
// which breaks text editing — so on Linux the frontend keeps its own JS keyboard
// handling and we attach no accelerators here.
fn accelerators_enabled() -> bool {
    !cfg!(target_os = "linux")
}

// Appends one submenu's specs, collecting gated item handles into `gated`.
fn build_submenu(
    app: &AppHandle,
    name: &str,
    specs: &[Spec],
    overrides: &HashMap<String, String>,
    gated: &mut Vec<(MenuItem<Wry>, Gate, bool)>,
) -> tauri::Result<Submenu<Wry>> {
    let submenu = match Submenu::new(app, name, true) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };

    // The Edit menu also carries the standard clipboard/undo items so the webview
    // gets working OS shortcuts — but only where they don't trip the WebKitGTK
    // swallow trap (see `accelerators_enabled`).
    if name == "Edit" && accelerators_enabled() {
        let clipboard = match edit_clipboard_items(app) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
        for predefined in clipboard.iter() {
            match submenu.append(predefined) {
                Ok(val) => val,
                Err(e) => return Err(e),
            };
        }
        let separator = match PredefinedMenuItem::separator(app) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
        match submenu.append(&separator) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
    }

    for spec in specs.iter() {
        match spec {
            Spec::Separator => {
                let separator = match PredefinedMenuItem::separator(app) {
                    Ok(val) => val,
                    Err(e) => return Err(e),
                };
                match submenu.append(&separator) {
                    Ok(val) => val,
                    Err(e) => return Err(e),
                };
            }
            Spec::Placeholder { id, label } => {
                let item = match MenuItem::with_id(app, *id, *label, false, None::<&str>) {
                    Ok(val) => val,
                    Err(e) => return Err(e),
                };
                match submenu.append(&item) {
                    Ok(val) => val,
                    Err(e) => return Err(e),
                };
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
                let item = match MenuItem::with_id(app, *id, *label, enabled, accelerator) {
                    Ok(val) => val,
                    Err(e) => return Err(e),
                };
                match submenu.append(&item) {
                    Ok(val) => val,
                    Err(e) => return Err(e),
                };
                if let Some(gate_value) = gate {
                    gated.push((item.clone(), *gate_value, is_write_action(id)));
                }
            }
        }
    }

    Ok(submenu)
}

// The predefined undo/redo/cut/copy/paste/select-all items for the Edit menu.
fn edit_clipboard_items(app: &AppHandle) -> tauri::Result<Vec<PredefinedMenuItem<Wry>>> {
    let undo = match PredefinedMenuItem::undo(app, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let redo = match PredefinedMenuItem::redo(app, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let separator = match PredefinedMenuItem::separator(app) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let cut = match PredefinedMenuItem::cut(app, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let copy = match PredefinedMenuItem::copy(app, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let paste = match PredefinedMenuItem::paste(app, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let select_all = match PredefinedMenuItem::select_all(app, None) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
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
// (for later enable/disable updates).
pub fn build(
    app: &AppHandle,
    overrides: &HashMap<String, String>,
) -> tauri::Result<(Menu<Wry>, Vec<(MenuItem<Wry>, Gate, bool)>)> {
    let menu = match Menu::new(app) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let mut gated: Vec<(MenuItem<Wry>, Gate, bool)> = Vec::new();

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

    for (name, specs) in menus().iter() {
        let submenu = match build_submenu(app, name, specs, overrides, &mut gated) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
        match menu.append(&submenu) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
    }

    Ok((menu, gated))
}
