use tauri::{AppHandle, Emitter, State};

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

// Carved out of this file when it outgrew the size limit: the menu table is pure data,
// the builder is Tauri construction, and the pop-out document window only lives here
// because a menu item happens to open it. Re-exported flat so `crate::menu::menus`,
// `crate::menu::build` and `crate::menu::DocumentTarget` all still resolve.
mod build;
mod document_window;
mod table;

pub use build::{build, MenuItems};
pub use document_window::{open_document_window, DocumentTarget};
pub use table::menus;

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
    pub read_only: bool,
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

// The document/collection write actions, disabled while the active tab's read-only
// lock is on. Mirrored by WRITE_ACTIONS in src/utils/writable.js — keep both in
// step; the tests pin the exact set on each side.
pub const WRITE_ACTIONS: &[&str] = &[
    "doc:edit_json",
    "doc:delete",
    "doc:add_field",
    "doc:edit_value",
    "doc:rename_field",
    "doc:remove_field",
    "coll:insert_document",
    "coll:update_dialog",
    "coll:delete_dialog",
    "coll:clear",
    "edit:paste_documents",
];

pub fn is_write_action(id: &str) -> bool {
    WRITE_ACTIONS.contains(&id)
}

// Full enablement for a gated item: the selection gate AND (for write actions) an
// unlocked tab. `is_write` is the item's write flag (see is_write_action).
pub fn item_enabled(gate: Gate, is_write: bool, context: &MenuContext) -> bool {
    gate_enabled(gate, context) && (!is_write || !context.read_only)
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
    read_only: bool,
) -> Result<(), String> {
    let context = MenuContext {
        has_connection: has_connection,
        has_database: has_database,
        has_collection: has_collection,
        any_connection: any_connection,
        has_document: has_document,
        has_field: has_field,
        has_index: has_index,
        read_only: read_only,
    };
    let guard = match items.0.lock() {
        Ok(val) => val,
        Err(e) => return Err(e.to_string()),
    };
    for (item, gate, is_write) in guard.iter() {
        let enabled = item_enabled(*gate, *is_write, &context);
        match item.set_enabled(enabled) {
            Ok(val) => val,
            Err(e) => return Err(e.to_string()),
        };
    }
    Ok(())
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
            read_only: false,
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
            read_only: false,
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
            read_only: false,
        }
    }

    // Full context with the read-only lock flag (write-gate tests).
    fn locked_context() -> MenuContext {
        MenuContext {
            has_connection: true,
            has_database: true,
            has_collection: true,
            any_connection: true,
            has_document: true,
            has_field: true,
            has_index: false,
            read_only: true,
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
    fn write_actions_disable_while_the_tab_is_locked() {
        // Every write action is off under the lock, even with full selection context.
        for id in WRITE_ACTIONS {
            let gate = gate_of(id);
            assert!(
                !item_enabled(gate, is_write_action(id), &locked_context()),
                "{id} should be disabled while read-only"
            );
            // Same action, unlocked context: the gate alone decides.
            assert_eq!(
                item_enabled(gate, is_write_action(id), &doc_context(true, true)),
                gate_enabled(gate, &doc_context(true, true)),
                "{id} should enable when unlocked"
            );
        }
    }

    #[test]
    fn read_only_actions_stay_enabled_while_the_tab_is_locked() {
        // View and copy actions are read-only: the lock never disables them.
        for id in ["doc:view_json", "edit:copy", "edit:copy_document", "edit:copy_value"] {
            assert!(!is_write_action(id), "{id} should not be a write action");
            assert!(
                item_enabled(gate_of(id), is_write_action(id), &locked_context()),
                "{id} should stay enabled while read-only"
            );
        }
    }

    #[test]
    fn write_action_list_matches_the_expected_set() {
        let mut list: Vec<&str> = WRITE_ACTIONS.to_vec();
        list.sort();
        assert_eq!(list, vec![
            "coll:clear",
            "coll:delete_dialog",
            "coll:insert_document",
            "coll:update_dialog",
            "doc:add_field",
            "doc:delete",
            "doc:edit_json",
            "doc:edit_value",
            "doc:remove_field",
            "doc:rename_field",
            "edit:paste_documents",
        ]);
        // Every write action must be gated (the set_menu_context loop only walks
        // gated items, so an ungated write action could never be disabled).
        for id in WRITE_ACTIONS {
            assert!(gate_of_opt(id).is_some(), "{id} should be gated");
        }
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
