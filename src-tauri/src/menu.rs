use crate::uri::percent_encode;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, Wry,
};

// The native OS menu. On macOS it renders in the system menu bar (with ⌘
// accelerators + the standard application menu); on Windows/Linux it renders as
// the native in-window menu. The structure and labels mirror what used to be the
// custom Vue bar (src/components/Menubar.vue): File, Edit, Database, Collection,
// Index, Document, GridFS, View, Help.
//
// Clicking an item emits `menu-action` with the item id; the frontend listens
// and routes it through the same `handleMenuAction` logic the custom bar used, so
// no action is reimplemented here.
//
// Enable/disable is context-driven. Items that gate on the current
// connection/database/collection selection start disabled and are toggled by the
// `set_menu_context` command, which the frontend calls whenever the active tab or
// the sidebar/tree selection changes. Items with no gate (Connect…,
// Preferences…, Keyboard Shortcuts, Exit) stay always enabled; `built:false`
// placeholders stay always disabled.

// Which selection an item needs before it can be used.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Gate {
    // A connection is resolvable (active tab or a selected sidebar node).
    Connection,
    // A database is resolvable.
    Database,
    // A collection is resolvable.
    Collection,
    // At least one connection is open in the tree (used by Refresh, whose handler
    // refreshes every connection rather than one specific node).
    AnyConnection,
    // A document row is selected in the active collection's results view (the
    // Document-menu actions that operate on a whole document).
    Document,
    // A field/cell is selected in the active collection's results view (the
    // Document-menu actions that operate on one field of the selected document).
    DocumentField,
    // An index row is selected in the open Indexes dialog (the Index-menu actions,
    // which all operate on the selected index).
    Index,
}

// The live selection context, mirrored from the frontend's `menuContext`.
pub struct MenuContext {
    pub has_connection: bool,
    pub has_database: bool,
    pub has_collection: bool,
    pub any_connection: bool,
    pub has_document: bool,
    pub has_field: bool,
    pub has_index: bool,
}

// Whether an item with the given gate should be enabled in the given context.
// Kept as a small pure function so the enable/disable derivation is unit-testable
// without constructing a real (main-thread-only) native menu.
pub fn gate_enabled(gate: Gate, context: &MenuContext) -> bool {
    match gate {
        Gate::Connection => context.has_connection,
        Gate::Database => context.has_database,
        Gate::Collection => context.has_collection,
        Gate::AnyConnection => context.any_connection,
        Gate::Document => context.has_document,
        Gate::DocumentField => context.has_field,
        Gate::Index => context.has_index,
    }
}

// One row in a submenu.
pub enum Spec {
    // A working item wired to a frontend handler. `gate: None` means always
    // enabled (the 5 always-on items); `gate: Some(_)` means context-gated.
    Action {
        id: &'static str,
        label: &'static str,
        accel: Option<&'static str>,
        gate: Option<Gate>,
    },
    // A `built:false` placeholder — carried over as a present-but-disabled item.
    Placeholder {
        id: &'static str,
        label: &'static str,
    },
    Separator,
}

// The logical app menus (File..Help) with their gates. The macOS application
// menu and the platform-specific predefined Edit items (undo/copy/paste…) are
// added separately in `build`, so this table stays deterministic and testable.
pub fn menus() -> Vec<(&'static str, Vec<Spec>)> {
    vec![
        (
            "File",
            vec![
                Spec::Action { id: "file:connect", label: "Connect…", accel: Some("CmdOrCtrl+N"), gate: None },
                Spec::Action { id: "file:add_database", label: "Add Database…", accel: None, gate: Some(Gate::Connection) },
                Spec::Separator,
                Spec::Action { id: "file:intellishell", label: "Open IntelliShell", accel: Some("CmdOrCtrl+L"), gate: Some(Gate::Database) },
                Spec::Action { id: "file:sql", label: "Open SQL", accel: Some("CmdOrCtrl+Shift+L"), gate: Some(Gate::Collection) },
                Spec::Action { id: "file:tasks", label: "Open Tasks", accel: None, gate: None },
                Spec::Action { id: "file:search", label: "Search in…", accel: None, gate: Some(Gate::Database) },
                Spec::Placeholder { id: "file:manage_sql", label: "Manage SQL Connections" },
                Spec::Separator,
                // Load opens the saved-query browser; Save opens the save-query form.
                // Both act on the active collection tab's query.
                Spec::Action { id: "file:load", label: "Load", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "file:save", label: "Save", accel: None, gate: Some(Gate::Collection) },
                Spec::Separator,
                Spec::Action { id: "file:server_charts", label: "Server Status Charts", accel: None, gate: Some(Gate::Connection) },
                Spec::Action { id: "file:server_status", label: "Server Status", accel: None, gate: Some(Gate::Connection) },
                Spec::Action { id: "file:server_build", label: "Server Build Info", accel: None, gate: Some(Gate::Connection) },
                Spec::Separator,
                Spec::Action { id: "file:exit", label: "Exit", accel: Some("CmdOrCtrl+Q"), gate: None },
            ],
        ),
        (
            "Edit",
            vec![
                // Clipboard copies act on the row/field/value selected in the active
                // results grid; Paste inserts clipboard document(s) into the active
                // collection. No accelerators — the predefined Copy/Paste above already
                // own Ctrl+C / Ctrl+V for text fields.
                Spec::Action { id: "edit:copy", label: "Copy", accel: None, gate: Some(Gate::Document) },
                Spec::Action { id: "edit:copy_value", label: "Copy Value", accel: None, gate: Some(Gate::DocumentField) },
                Spec::Action { id: "edit:copy_field", label: "Copy Field", accel: None, gate: Some(Gate::DocumentField) },
                Spec::Action { id: "edit:copy_field_path", label: "Copy Field Path", accel: None, gate: Some(Gate::DocumentField) },
                Spec::Action { id: "edit:copy_document", label: "Copy Document", accel: None, gate: Some(Gate::Document) },
                Spec::Action { id: "edit:paste_documents", label: "Paste Document(s)", accel: None, gate: Some(Gate::Collection) },
                Spec::Separator,
                Spec::Action { id: "edit:preferences", label: "Preferences…", accel: Some("CmdOrCtrl+P"), gate: None },
            ],
        ),
        (
            "Database",
            vec![
                Spec::Action { id: "db:add_database", label: "Add Database…", accel: None, gate: Some(Gate::Connection) },
                Spec::Action { id: "db:copy_database", label: "Copy Database", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "db:copy_all", label: "Copy All Collections/Views/Buckets", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "db:paste_database", label: "Paste Database", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "db:paste", label: "Paste", accel: None, gate: Some(Gate::Database) },
                Spec::Separator,
                Spec::Action { id: "db:export", label: "Export Collections…", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "db:import", label: "Import Collections…", accel: None, gate: Some(Gate::Database) },
                Spec::Separator,
                Spec::Action { id: "db:drop_database", label: "Drop Database", accel: None, gate: Some(Gate::Database) },
                Spec::Separator,
                Spec::Action { id: "db:add_collection", label: "Add Collection…", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "db:add_view", label: "Add View…", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "db:add_bucket", label: "Add GridFS Bucket…", accel: None, gate: Some(Gate::Database) },
                Spec::Separator,
                Spec::Action { id: "db:manage_users", label: "Manage Users", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "db:manage_roles", label: "Manage Roles", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "db:functions", label: "Add / Edit Stored Functions", accel: None, gate: Some(Gate::Database) },
                Spec::Separator,
                Spec::Action { id: "db:database_stats", label: "Database Statistics", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "db:profiler", label: "Query Profiler", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "db:collection_stats", label: "Collection Statistics", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "db:current_ops", label: "Current Operations", accel: None, gate: Some(Gate::Connection) },
            ],
        ),
        (
            "Collection",
            vec![
                Spec::Action { id: "coll:open_tab", label: "Open Collection Tab", accel: Some("F10"), gate: Some(Gate::Connection) },
                Spec::Action { id: "coll:aggregation", label: "Open Aggregation Editor", accel: Some("F4"), gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:mapreduce", label: "Open Map-Reduce", accel: None, gate: Some(Gate::Collection) },
                Spec::Separator,
                Spec::Action { id: "coll:insert_document", label: "Insert Document…", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:update_dialog", label: "Update Dialog…", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:delete_dialog", label: "Delete Dialog…", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:vqb", label: "Show Visual Query Builder", accel: Some("CmdOrCtrl+B"), gate: Some(Gate::Collection) },
                Spec::Separator,
                Spec::Action { id: "coll:export", label: "Export…", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:import", label: "Import…", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:copy", label: "Copy Collection", accel: None, gate: Some(Gate::Collection) },
                Spec::Separator,
                Spec::Action { id: "coll:add_index", label: "Add Index…", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:validator", label: "Add / Edit Validator…", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:add_view", label: "Add View Here…", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:stats", label: "Collection Stats", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:mask", label: "Mask Collection/View", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:schema", label: "View Schema", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:history", label: "Collection History", accel: None, gate: Some(Gate::Collection) },
                Spec::Separator,
                Spec::Action { id: "coll:rename", label: "Rename Collection…", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:duplicate", label: "Duplicate Collection…", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:clear", label: "Clear Collection", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "coll:drop", label: "Drop Collection…", accel: None, gate: Some(Gate::Collection) },
            ],
        ),
        (
            "Index",
            vec![
                Spec::Action { id: "idx:edit", label: "Edit Index…", accel: None, gate: Some(Gate::Index) },
                Spec::Action { id: "idx:view", label: "View Details", accel: None, gate: Some(Gate::Index) },
                Spec::Action { id: "idx:copy", label: "Copy Index", accel: None, gate: Some(Gate::Index) },
                Spec::Action { id: "idx:drop", label: "Drop Index", accel: None, gate: Some(Gate::Index) },
                Spec::Separator,
                Spec::Action { id: "idx:hide", label: "Hide Index", accel: None, gate: Some(Gate::Index) },
                Spec::Action { id: "idx:unhide", label: "Unhide Index", accel: None, gate: Some(Gate::Index) },
            ],
        ),
        (
            "Document",
            vec![
                Spec::Action { id: "doc:edit_value", label: "Edit Value / Type…", accel: None, gate: Some(Gate::DocumentField) },
                Spec::Action { id: "doc:remove_field", label: "Remove Field", accel: None, gate: Some(Gate::DocumentField) },
                Spec::Action { id: "doc:rename_field", label: "Rename Field…", accel: None, gate: Some(Gate::DocumentField) },
                Spec::Action { id: "doc:add_field", label: "Add Field / Value…", accel: None, gate: Some(Gate::Document) },
                Spec::Separator,
                Spec::Action { id: "doc:view_json", label: "View Document (JSON)…", accel: None, gate: Some(Gate::Document) },
                Spec::Action { id: "doc:edit_json", label: "Edit Document (JSON)…", accel: Some("CmdOrCtrl+J"), gate: Some(Gate::Document) },
                Spec::Action { id: "doc:delete", label: "Delete Document", accel: None, gate: Some(Gate::Document) },
            ],
        ),
        (
            "GridFS",
            vec![
                Spec::Action { id: "gridfs:open", label: "Open GridFS View", accel: None, gate: Some(Gate::Database) },
                Spec::Separator,
                // GridFS file/bucket ops act inside the GridFS view on its selected
                // file/bucket; enabled whenever a database is resolvable.
                Spec::Action { id: "gridfs:view_file", label: "View File", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "gridfs:rename", label: "Rename File…", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "gridfs:meta", label: "Edit Meta Data…", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "gridfs:save", label: "Save To Disk…", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "gridfs:remove", label: "Remove File(s)", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "gridfs:add", label: "Add File(s)…", accel: None, gate: Some(Gate::Database) },
                Spec::Separator,
                Spec::Action { id: "gridfs:copy_bucket", label: "Copy Bucket", accel: None, gate: Some(Gate::Database) },
                Spec::Action { id: "gridfs:drop_bucket", label: "Drop Bucket", accel: None, gate: Some(Gate::Database) },
            ],
        ),
        (
            "View",
            vec![
                Spec::Action { id: "view:refresh", label: "Refresh", accel: Some("CmdOrCtrl+R"), gate: Some(Gate::AnyConnection) },
                // Re-runs the active collection tab's query to refresh its results.
                Spec::Action { id: "view:refresh_document", label: "Refresh Document", accel: None, gate: Some(Gate::Collection) },
                Spec::Separator,
                // Drill navigation over the active collection's results (field-path based).
                Spec::Action { id: "view:step_column", label: "Step Into Column", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "view:step_cell", label: "Step Into Cell", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "view:step_out", label: "Step Out", accel: None, gate: Some(Gate::Collection) },
                Spec::Separator,
                // The active collection tab's results view mode (mirrors the in-panel
                // view picker). Gated on a collection; no-op with a toast otherwise.
                Spec::Action { id: "view:tree", label: "Tree View", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "view:table", label: "Table View", accel: None, gate: Some(Gate::Collection) },
                Spec::Action { id: "view:json", label: "JSON View", accel: None, gate: Some(Gate::Collection) },
                Spec::Separator,
                // Tab navigation/closing act on the active tab; always enabled (they
                // no-op safely when there are 0–1 tabs), so no gate.
                Spec::Action { id: "view:next_tab", label: "Next Tab", accel: Some("CmdOrCtrl+Tab"), gate: None },
                Spec::Action { id: "view:prev_tab", label: "Previous Tab", accel: Some("CmdOrCtrl+Shift+Tab"), gate: None },
                Spec::Action { id: "view:close_tab", label: "Close Tab", accel: None, gate: None },
                Spec::Action { id: "view:close_tab_np", label: "Close Tab (No Prompt)", accel: None, gate: None },
                Spec::Separator,
                Spec::Action { id: "view:history", label: "History Manager…", accel: None, gate: Some(Gate::Collection) },
                // Toggles the global toolbar; the label stays "Hide Global Toolbar"
                // (native menu labels aren't re-titled), a toast reports the new state.
                Spec::Action { id: "view:hide_toolbar", label: "Hide Global Toolbar", accel: None, gate: None },
            ],
        ),
        (
            "Help",
            vec![
                Spec::Action { id: "help:shortcuts", label: "Keyboard Shortcuts", accel: None, gate: None },
                Spec::Separator,
                Spec::Action { id: "help:license", label: "My License", accel: None, gate: None },
                Spec::Action { id: "help:about", label: "About…", accel: None, gate: None },
                Spec::Action { id: "help:gallery", label: "Feature Gallery", accel: None, gate: None },
                Spec::Action { id: "help:quickstart", label: "Quickstart", accel: None, gate: None },
                Spec::Action { id: "help:whats_new", label: "What's New", accel: None, gate: None },
                Spec::Action { id: "help:updates", label: "Check for Updates…", accel: None, gate: None },
                Spec::Separator,
                Spec::Action { id: "help:support", label: "Contact Support", accel: None, gate: None },
                Spec::Action { id: "help:feature_request", label: "Submit a Feature Request", accel: None, gate: None },
                Spec::Action { id: "help:feedback", label: "Submit Feedback", accel: None, gate: None },
                Spec::Action { id: "help:tutorials", label: "In-app Tutorials", accel: None, gate: None },
                Spec::Action { id: "help:knowledge_base", label: "Knowledge Base", accel: None, gate: None },
            ],
        ),
    ]
}

// Managed state: the gated items and their gate, so `set_menu_context` can flip
// their enabled flag without rebuilding the whole menu.
pub struct MenuItems(pub Mutex<Vec<(MenuItem<Wry>, Gate)>>);

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
    gated: &mut Vec<(MenuItem<Wry>, Gate)>,
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
                    gated.push((item.clone(), *gate_value));
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
) -> tauri::Result<(Menu<Wry>, Vec<(MenuItem<Wry>, Gate)>)> {
    let menu = match Menu::new(app) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let mut gated: Vec<(MenuItem<Wry>, Gate)> = Vec::new();

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

// Routes a native menu click to the frontend, which already owns every action via
// `handleMenuAction`. Predefined items (copy/paste/quit…) are handled by the OS
// itself; emitting their ids too is harmless (the frontend has no case for them).
pub fn handle_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref().to_string();
    let _ = app.emit("menu-action", id);
}

// Updates the enabled state of every gated item to match the current selection
// context. Called by the frontend whenever the active tab or the sidebar/tree
// selection changes.
#[tauri::command]
pub fn set_menu_context(
    items: State<'_, MenuItems>,
    has_connection: bool,
    has_database: bool,
    has_collection: bool,
    any_connection: bool,
    has_document: bool,
    has_field: bool,
    has_index: bool,
) -> Result<(), String> {
    let context = MenuContext {
        has_connection: has_connection,
        has_database: has_database,
        has_collection: has_collection,
        any_connection: any_connection,
        has_document: has_document,
        has_field: has_field,
        has_index: has_index,
    };
    let guard = match items.0.lock() {
        Ok(val) => val,
        Err(e) => return Err(e.to_string()),
    };
    for (item, gate) in guard.iter() {
        let enabled = gate_enabled(*gate, &context);
        match item.set_enabled(enabled) {
            Ok(val) => val,
            Err(e) => return Err(e.to_string()),
        };
    }
    Ok(())
}

// The document a pop-out editor window is pointed at. Sent from the frontend as a plain
// object (camelCase), passed on the first-open URL, and re-broadcast as the
// `document-target` event when the single window is retargeted at a different document.
// Default window mode when the frontend omits it (defensive; the frontend always sends it).
fn default_mode() -> String {
    String::from("edit")
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTarget {
    pub conn_id: String,
    pub db: String,
    pub coll: String,
    pub id_filter: String,
    pub label: String,
    // "edit" — the single, focus-locked editor window; "view" — an unlimited, read-only
    // display window; "insert" — the single, focus-locked new-document window (no target
    // document; id_filter is unused).
    #[serde(default = "default_mode")]
    pub mode: String,
}


// Monotonic sequence for unique read-only view-window labels. View windows are unlimited
// and independent, so each open gets its own label (unlike the single editor window).
static VIEW_WINDOW_SEQ: AtomicU64 = AtomicU64::new(0);

// Open a document window.
//
// - mode "edit": the SINGLE reusable editor window (label "doc-editor"). If it already
//   exists we re-point it via the `document-target` event and focus it. On first build it
//   is focus-locked over the app — always-on-top + focused, so it can't be buried
//   ("cannot be unfocused"; Tauri 2.3.1 has no native modal, so this is the approximation).
// - mode "view": an unlimited, non-modal, hideable read-only window (unique label each).
// - mode "insert": the SINGLE reusable new-document window (label "doc-insert"), same
//   focus-locked, retargetable behaviour as the editor but with no seeded document.
//
// Either way the initial target is seeded on the URL query so the first load has its
// document even before the page registers its `document-target` listener.
pub fn open_document_window(app: &AppHandle, target: DocumentTarget) {
    let is_view = target.mode == "view";
    let is_insert = target.mode == "insert";

    // The editor and insert windows are single reusable windows; view windows never
    // retarget. Insert has no per-document target, but retargeting still lets a fresh
    // "+" on another collection re-point the open window at that collection.
    if !is_view {
        let reuse_label = if is_insert { "doc-insert" } else { "doc-editor" };
        if let Some(w) = app.get_webview_window(reuse_label) {
            match app.emit_to(reuse_label, "document-target", target.clone()) {
                Ok(val) => val,
                Err(_e) => (),
            };
            w.set_focus().ok();
            return;
        }
    }

    let query = format!(
        "connId={}&db={}&coll={}&idFilter={}&label={}&mode={}",
        percent_encode(&target.conn_id),
        percent_encode(&target.db),
        percent_encode(&target.coll),
        percent_encode(&target.id_filter),
        percent_encode(&target.label),
        percent_encode(&target.mode),
    );
    let url = format!("src/pages/document.html?{}", query);

    let label = if is_view {
        let seq = VIEW_WINDOW_SEQ.fetch_add(1, Ordering::Relaxed);
        format!("doc-view-{}", seq)
    } else if is_insert {
        String::from("doc-insert")
    } else {
        String::from("doc-editor")
    };
    let title = if is_view {
        "View Document"
    } else if is_insert {
        "Insert Document"
    } else {
        "Edit Document"
    };

    // Give the OS window a dark background so it appears in-theme immediately instead of a
    // white flash while the webview loads its bundle and paints the document.
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(720.0, 640.0)
        .resizable(true)
        .center()
        .focused(true)
        .background_color(tauri::window::Color(31, 32, 35, 255));

    // The editor floats above the main window so it can't be buried; view windows stay
    // normal (non-modal, hideable, can sit behind other windows).
    if !is_view {
        builder = builder.always_on_top(true);
    }

    builder.build().ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(
        has_connection: bool,
        has_database: bool,
        has_collection: bool,
        any_connection: bool,
    ) -> MenuContext {
        MenuContext {
            has_connection: has_connection,
            has_database: has_database,
            has_collection: has_collection,
            any_connection: any_connection,
            has_document: false,
            has_field: false,
            has_index: false,
        }
    }

    // Context with the document/field flags set, for the Document-menu gates.
    fn doc_context(has_document: bool, has_field: bool) -> MenuContext {
        MenuContext {
            has_connection: true,
            has_database: true,
            has_collection: true,
            any_connection: true,
            has_document: has_document,
            has_field: has_field,
            has_index: false,
        }
    }

    // Context with the index-selection flag set, for the Index-menu gate.
    fn index_context(has_index: bool) -> MenuContext {
        MenuContext {
            has_connection: true,
            has_database: true,
            has_collection: true,
            any_connection: true,
            has_document: false,
            has_field: false,
            has_index: has_index,
        }
    }

    #[test]
    fn gate_enabled_reads_the_matching_context_flag() {
        let all_off = context(false, false, false, false);
        assert!(!gate_enabled(Gate::Connection, &all_off));
        assert!(!gate_enabled(Gate::Database, &all_off));
        assert!(!gate_enabled(Gate::Collection, &all_off));
        assert!(!gate_enabled(Gate::AnyConnection, &all_off));
        assert!(!gate_enabled(Gate::Document, &all_off));
        assert!(!gate_enabled(Gate::DocumentField, &all_off));
        assert!(!gate_enabled(Gate::Index, &all_off));

        assert!(gate_enabled(Gate::Connection, &context(true, false, false, false)));
        assert!(gate_enabled(Gate::Database, &context(false, true, false, false)));
        assert!(gate_enabled(Gate::Collection, &context(false, false, true, false)));
        assert!(gate_enabled(Gate::AnyConnection, &context(false, false, false, true)));
    }

    #[test]
    fn document_gates_track_document_and_field_selection() {
        // No selection: neither the whole-document nor the field actions enable.
        let none = doc_context(false, false);
        assert!(!gate_enabled(Gate::Document, &none));
        assert!(!gate_enabled(Gate::DocumentField, &none));

        // A row is selected but no field: whole-document actions enable, field ones
        // stay disabled.
        let row_only = doc_context(true, false);
        assert!(gate_enabled(Gate::Document, &row_only));
        assert!(!gate_enabled(Gate::DocumentField, &row_only));

        // A field is selected (which implies a row): both enable.
        let field = doc_context(true, true);
        assert!(gate_enabled(Gate::Document, &field));
        assert!(gate_enabled(Gate::DocumentField, &field));
    }

    #[test]
    fn index_gate_tracks_index_selection() {
        // No index selected: the Index-menu actions stay disabled.
        assert!(!gate_enabled(Gate::Index, &index_context(false)));
        // An index row is selected in the open Indexes dialog: they enable.
        assert!(gate_enabled(Gate::Index, &index_context(true)));
    }

    #[test]
    fn index_menu_items_gate_on_a_selected_index() {
        for id in ["idx:edit", "idx:view", "idx:copy", "idx:drop", "idx:hide", "idx:unhide"] {
            assert_eq!(gate_of(id), Gate::Index, "{id} should gate on a selected index");
        }
    }

    #[test]
    fn document_and_collection_editing_items_have_the_expected_gates() {
        // Field-scoped Document actions.
        for id in ["doc:edit_value", "doc:remove_field", "doc:rename_field"] {
            assert_eq!(gate_of(id), Gate::DocumentField, "{id} should gate on a field");
        }
        // Whole-document actions.
        for id in ["doc:add_field", "doc:view_json", "doc:edit_json", "doc:delete"] {
            assert_eq!(gate_of(id), Gate::Document, "{id} should gate on a document");
        }
        // Collection document-editing actions gate on an active collection.
        for id in ["coll:insert_document", "coll:update_dialog", "coll:delete_dialog", "coll:clear"] {
            assert_eq!(gate_of(id), Gate::Collection, "{id} should gate on a collection");
        }
    }

    #[test]
    fn edit_menu_clipboard_items_have_the_expected_gates() {
        // Whole-document copies enable when a document row is selected.
        for id in ["edit:copy", "edit:copy_document"] {
            assert_eq!(gate_of(id), Gate::Document, "{id} should gate on a document");
        }
        // Field-scoped copies enable when a field/cell is selected.
        for id in ["edit:copy_value", "edit:copy_field", "edit:copy_field_path"] {
            assert_eq!(gate_of(id), Gate::DocumentField, "{id} should gate on a field");
        }
        // Paste inserts into the active collection.
        assert_eq!(gate_of("edit:paste_documents"), Gate::Collection);
    }

    #[test]
    fn refresh_enables_on_any_connection_even_without_active_tab_context() {
        // The original bug: Refresh acts on every tree connection, so it must
        // enable whenever a connection exists — not only when the active tab has
        // one. AnyConnection captures that.
        let only_any = context(false, false, false, true);
        assert!(gate_enabled(gate_of("view:refresh"), &only_any));
    }

    #[test]
    fn sidebar_selection_enables_collection_scoped_items() {
        // A collection selected in the sidebar makes has_collection true even when
        // the active tab is Quickstart, so collection-scoped items enable.
        let sidebar_collection = context(true, true, true, true);
        for id in ["coll:export", "coll:schema", "coll:drop", "coll:aggregation"] {
            assert!(gate_enabled(gate_of(id), &sidebar_collection), "{id} should enable");
        }
    }

    #[test]
    fn open_collection_tab_gates_on_connection() {
        // Open Collection Tab's handler opens the sidebar-highlighted collection;
        // it enables as soon as a connection/selection exists.
        assert_eq!(gate_of("coll:open_tab"), Gate::Connection);
    }

    #[test]
    fn menu_gates_match_the_expected_map() {
        assert_eq!(gate_of("view:refresh"), Gate::AnyConnection);
        assert_eq!(gate_of("file:server_status"), Gate::Connection);
        assert_eq!(gate_of("file:intellishell"), Gate::Database);
        assert_eq!(gate_of("db:add_collection"), Gate::Database);
        assert_eq!(gate_of("coll:schema"), Gate::Collection);
        assert_eq!(gate_of("db:collection_stats"), Gate::Collection);
        assert_eq!(gate_of("file:sql"), Gate::Collection);
    }

    #[test]
    fn always_on_items_have_no_gate() {
        for id in ["file:connect", "edit:preferences", "help:shortcuts", "file:exit"] {
            assert!(spec_of(id).is_some(), "{id} should exist");
            assert!(gate_of_opt(id).is_none(), "{id} should be always-on");
        }
    }

    #[test]
    fn placeholders_are_carried_over_but_ungated() {
        // A representative built:false placeholder is present and never gated on.
        assert!(matches!(spec_of("file:manage_sql"), Some(Spec::Placeholder { .. })));
        assert!(gate_of_opt("file:manage_sql").is_none());
    }

    // Test helpers: look an item up by id in the logical menu table.
    fn spec_of(id: &str) -> Option<Spec> {
        for (_name, specs) in menus() {
            for spec in specs {
                let matches = match &spec {
                    Spec::Action { id: item_id, .. } => *item_id == id,
                    Spec::Placeholder { id: item_id, .. } => *item_id == id,
                    Spec::Separator => false,
                };
                if matches {
                    return Some(spec);
                }
            }
        }
        None
    }

    fn gate_of_opt(id: &str) -> Option<Gate> {
        match spec_of(id) {
            Some(Spec::Action { gate: gate, .. }) => gate,
            _ => None,
        }
    }

    fn gate_of(id: &str) -> Gate {
        match gate_of_opt(id) {
            Some(gate) => gate,
            None => panic!("expected {id} to be a gated action"),
        }
    }
}
