use tauri::{AppHandle, Emitter, Manager, State};

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

pub use build::{build, clear_accelerators, install, MenuItems, MenuState};
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
    // At least one connection is open in the tree (used by Refresh All Connections,
    // which refreshes every connection rather than one specific node).
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
    // The active tab is a view that only reads, so reloading it can't change data
    // (Refresh; see canRefreshWorkspace in the frontend's workspaces/lifecycle.js).
    RefreshableTab,
    // The active tab is a PostgreSQL workspace naming a schema (a query or table
    // tab) — #145. Unlike Connection/Database/Collection, this is PostgreSQL-
    // only and resolved from the active tab alone; the sidebar tree doesn't yet
    // feed a PostgreSQL selection into the menu context (see menuContext.js).
    PgSchema,
    // The active tab is a PostgreSQL table-browse workspace.
    PgTable,
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
    pub can_refresh_tab: bool,
    pub has_pg_schema: bool,
    pub has_pg_table: bool,
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
        Gate::RefreshableTab => context.can_refresh_tab,
        Gate::PgSchema => context.has_pg_schema,
        Gate::PgTable => context.has_pg_table,
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
    "pg:create_table",
    "pg:drop_table",
];

pub fn is_write_action(id: &str) -> bool {
    WRITE_ACTIONS.contains(&id)
}

// Full enablement for a gated item: the selection gate AND (for write actions) an
// unlocked tab. `is_write` is the item's write flag (see is_write_action).
pub fn item_enabled(gate: Gate, is_write: bool, context: &MenuContext) -> bool {
    gate_enabled(gate, context) && (!is_write || !context.read_only)
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum MenuEngine {
    MongoDb,
    Postgres,
}

// Which engine-specific items the menu shows (#152): one engine's, or neither.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum MenuScope {
    Neutral,
    Engine(MenuEngine),
}

// Read off the gate rather than tagged per item: a Mongo-shaped gate can never
// enable on a PostgreSQL target and vice versa, so hiding stays exactly "the items
// that would be dead here" and can't drift from the gating.
pub fn gate_engine(gate: Gate) -> Option<MenuEngine> {
    match gate {
        Gate::Connection | Gate::Database | Gate::Collection | Gate::Document | Gate::DocumentField | Gate::Index => {
            Some(MenuEngine::MongoDb)
        }
        Gate::PgSchema | Gate::PgTable => Some(MenuEngine::Postgres),
        Gate::AnyConnection | Gate::RefreshableTab => None,
    }
}

// The frontend's `engine` (see menuContext.js): 'none', or an engine this build may
// have no items for.
pub fn menu_scope_from_id(id: &str) -> MenuScope {
    match id {
        "mongodb" => MenuScope::Engine(MenuEngine::MongoDb),
        "postgresql" => MenuScope::Engine(MenuEngine::Postgres),
        _ => MenuScope::Neutral,
    }
}

// `menus()` minus the items outside `scope`, with separators re-tidied and any
// submenu left empty dropped.
pub fn menus_for(scope: MenuScope) -> Vec<(&'static str, Vec<Spec>)> {
    let mut result = Vec::new();
    for (name, specs) in menus() {
        let mut kept: Vec<Spec> = Vec::new();
        for spec in specs {
            let item_engine = match &spec {
                Spec::Action { gate: Some(gate), .. } => gate_engine(*gate),
                _ => None,
            };
            let shown = match (scope, item_engine) {
                (_, None) => true,
                (MenuScope::Neutral, Some(_)) => false,
                (MenuScope::Engine(engine), Some(item)) => item == engine,
            };
            if !shown {
                continue;
            }
            let is_separator = matches!(spec, Spec::Separator);
            if is_separator && matches!(kept.last(), None | Some(Spec::Separator)) {
                continue;
            }
            kept.push(spec);
        }
        if matches!(kept.last(), Some(Spec::Separator)) {
            kept.pop();
        }
        if !kept.is_empty() {
            result.push((name, kept));
        }
    }
    result
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
    let _ = app.emit(crate::events::MENU_ACTION, id);
}

// Updates the enabled state of every gated item to match the current selection
// context. Called by the frontend whenever the active tab or the sidebar/tree
// selection changes. Items can't be hidden in place (tauri/muda expose no
// visibility setter), so when the engine changes the whole menu is rebuilt and
// swapped before the enable states are applied to the fresh handles.
#[tauri::command]
pub fn set_menu_context(
    app: AppHandle,
    items: State<'_, MenuItems>,
    engine: String,
    has_connection: bool,
    has_database: bool,
    has_collection: bool,
    any_connection: bool,
    has_document: bool,
    has_field: bool,
    has_index: bool,
    read_only: bool,
    can_refresh_tab: bool,
    has_pg_schema: bool,
    has_pg_table: bool,
) -> Result<(), String> {
    let context = MenuContext {
        has_connection,
        has_database,
        has_collection,
        any_connection,
        has_document,
        has_field,
        has_index,
        read_only,
        can_refresh_tab,
        has_pg_schema,
        has_pg_table,
    };
    let mut state = match items.0.lock() {
        Ok(val) => val,
        Err(e) => return Err(e.to_string()),
    };
    let scope = menu_scope_from_id(&engine);
    if scope != state.scope {
        let overrides = app.state::<crate::keybindings::KeybindingStorage>().load();
        let built = match build(&app, &overrides, scope) {
            Ok(val) => val,
            Err(e) => return Err(e.to_string()),
        };
        clear_accelerators(&state.accelerated);
        install(&app, built.menu)?;
        state.scope = scope;
        state.gated = built.gated;
        state.accelerated = built.accelerated;
    }
    for (item, gate, is_write) in state.gated.iter() {
        let enabled = item_enabled(*gate, *is_write, &context);
        match item.set_enabled(enabled) {
            Ok(val) => val,
            Err(e) => return Err(e.to_string()),
        };
    }
    Ok(())
}

#[cfg(test)]
#[path = "menu.test.rs"]
mod tests;
