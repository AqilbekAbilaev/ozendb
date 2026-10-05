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
        can_refresh_tab: false,
        has_pg_schema: false,
        has_pg_table: false,
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
        can_refresh_tab: false,
        has_pg_schema: false,
        has_pg_table: false,
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
        can_refresh_tab: false,
        has_pg_schema: false,
        has_pg_table: false,
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
        can_refresh_tab: false,
        has_pg_schema: false,
        has_pg_table: false,
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
        "pg:create_table",
        "pg:drop_table",
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
fn refresh_all_enables_on_any_connection_even_without_active_tab_context() {
    // Refresh All acts on every tree connection, so it must enable whenever a
    // connection exists — not only when the active tab has one.
    let only_any = context(false, false, false, true);
    assert!(gate_enabled(gate_of("view:refresh_all"), &only_any));
}

#[test]
fn refresh_enables_only_on_a_tab_that_can_reload() {
    // Refresh reloads the active tab, so a connection alone isn't enough: an
    // aggregation or SQL editor mustn't be re-run by it.
    let mut ctx = context(true, true, true, true);
    assert!(!gate_enabled(gate_of("view:refresh"), &ctx));
    ctx.can_refresh_tab = true;
    assert!(gate_enabled(gate_of("view:refresh"), &ctx));
}

#[test]
fn refresh_all_has_its_own_key_and_enables_on_any_connection() {
    assert_eq!(gate_of("view:refresh_all"), Gate::AnyConnection);
    match spec_of("view:refresh_all") {
        Some(Spec::Action { accel, .. }) => assert_eq!(accel, Some("CmdOrCtrl+Shift+R")),
        _ => panic!("expected view:refresh_all to be an action"),
    }
}

#[test]
fn tab_navigation_avoids_the_chord_macos_reserves() {
    // ⌘Tab is the macOS app switcher and never reaches an app, so a CmdOrCtrl
    // default here is dead on macOS while working on Windows/Linux. Ctrl works on
    // all three. These must stay in step with keybindings.js, which drives the
    // Linux JS path and the Preferences editor.
    for id in ["view:next_tab", "view:prev_tab"] {
        match spec_of(id) {
            Some(Spec::Action { accel: Some(accel), .. }) => {
                assert!(accel.starts_with("Ctrl+"), "{id} is bound to {accel}, which is Cmd on macOS")
            }
            _ => panic!("expected {id} to be an action with an accelerator"),
        }
    }
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
    assert_eq!(gate_of("view:refresh"), Gate::RefreshableTab);
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

#[test]
fn pg_menu_items_gate_on_the_active_tabs_schema_or_table_not_the_mongo_gates() {
    // Schema-scoped PostgreSQL items enable from PgSchema alone, independent of
    // every Mongo-shaped gate (#145: PostgreSQL has no sidebar selection
    // feeding the menu context yet, so this never reaches via the tree).
    for id in ["pg:new_sql", "pg:create_table", "pg:search_schema"] {
        assert_eq!(gate_of(id), Gate::PgSchema, "{id} should gate on PgSchema");
    }
    for id in ["pg:row_history", "pg:drop_table"] {
        assert_eq!(gate_of(id), Gate::PgTable, "{id} should gate on PgTable");
    }

    let mut ctx = context(true, true, true, true); // every Mongo gate on
    for id in ["pg:new_sql", "pg:create_table", "pg:search_schema", "pg:row_history", "pg:drop_table"] {
        assert!(!gate_enabled(gate_of(id), &ctx), "{id} should stay off while has_pg_schema/has_pg_table are false");
    }
    ctx.has_pg_schema = true;
    for id in ["pg:new_sql", "pg:create_table", "pg:search_schema"] {
        assert!(gate_enabled(gate_of(id), &ctx), "{id} should enable once has_pg_schema is true");
    }
    assert!(!gate_enabled(gate_of("pg:row_history"), &ctx), "table-scoped items must stay off for a schema-only context");
    ctx.has_pg_table = true;
    assert!(gate_enabled(gate_of("pg:row_history"), &ctx));
    assert!(gate_enabled(gate_of("pg:drop_table"), &ctx));
}

#[test]
fn pg_create_and_drop_table_are_write_actions() {
    for id in ["pg:create_table", "pg:drop_table"] {
        assert!(is_write_action(id), "{id} should be a write action");
    }
    assert!(!is_write_action("pg:new_sql"));
    assert!(!is_write_action("pg:row_history"));
    assert!(!is_write_action("pg:search_schema"));
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
        Some(Spec::Action { gate, .. }) => gate,
        _ => None,
    }
}

fn gate_of(id: &str) -> Gate {
    match gate_of_opt(id) {
        Some(gate) => gate,
        None => panic!("expected {id} to be a gated action"),
    }
}

// #152: each engine sees only its own items, derived from the gates.

fn ids_and_names(scope: MenuScope) -> (Vec<&'static str>, Vec<&'static str>) {
    let mut names = Vec::new();
    let mut ids = Vec::new();
    for (name, specs) in menus_for(scope) {
        names.push(name);
        for spec in specs {
            match spec {
                Spec::Action { id, .. } | Spec::Placeholder { id, .. } => ids.push(id),
                Spec::Separator => {}
            }
        }
    }
    (names, ids)
}

#[test]
fn gate_engine_maps_each_gate_to_its_engine() {
    for gate in [Gate::Connection, Gate::Database, Gate::Collection, Gate::Document, Gate::DocumentField, Gate::Index] {
        assert_eq!(gate_engine(gate), Some(MenuEngine::MongoDb), "{gate:?}");
    }
    for gate in [Gate::PgSchema, Gate::PgTable] {
        assert_eq!(gate_engine(gate), Some(MenuEngine::Postgres), "{gate:?}");
    }
    for gate in [Gate::AnyConnection, Gate::RefreshableTab] {
        assert_eq!(gate_engine(gate), None, "{gate:?} should be engine-neutral");
    }
}

#[test]
fn postgres_hides_every_mongodb_item_and_menu() {
    let (names, ids) = ids_and_names(MenuScope::Engine(MenuEngine::Postgres));
    assert_eq!(names, vec!["File", "Edit", "PostgreSQL", "View", "Help"]);
    for id in &ids {
        let gate = gate_of_opt(id);
        assert!(gate.map(gate_engine) != Some(Some(MenuEngine::MongoDb)), "{id} is MongoDB-only");
    }
    for id in ["file:connect", "file:exit", "edit:preferences", "view:refresh", "view:refresh_all", "pg:drop_table"] {
        assert!(ids.contains(&id), "{id} should survive on PostgreSQL");
    }
}

#[test]
fn mongodb_hides_the_postgresql_menu() {
    let (names, ids) = ids_and_names(MenuScope::Engine(MenuEngine::MongoDb));
    assert!(!names.contains(&"PostgreSQL"));
    assert!(!ids.iter().any(|id| id.starts_with("pg:")));
    assert!(ids.contains(&"coll:drop"));
    assert!(ids.contains(&"file:connect"));
}

#[test]
fn filtered_menus_never_leave_an_empty_menu_or_stray_separator() {
    let scopes = [
        MenuScope::Neutral,
        MenuScope::Engine(MenuEngine::MongoDb),
        MenuScope::Engine(MenuEngine::Postgres),
    ];
    for engine in scopes {
        for (name, specs) in menus_for(engine) {
            assert!(specs.iter().any(|s| !matches!(s, Spec::Separator)), "{name} is empty for {engine:?}");
            assert!(!matches!(specs.first(), Some(Spec::Separator)), "{name} starts with a separator for {engine:?}");
            assert!(!matches!(specs.last(), Some(Spec::Separator)), "{name} ends with a separator for {engine:?}");
            for pair in specs.windows(2) {
                assert!(
                    !(matches!(pair[0], Spec::Separator) && matches!(pair[1], Spec::Separator)),
                    "{name} has adjacent separators for {engine:?}"
                );
            }
        }
    }
}

#[test]
fn neutral_scope_keeps_only_items_that_need_no_database() {
    let (names, ids) = ids_and_names(MenuScope::Neutral);
    assert_eq!(names, vec!["File", "Edit", "View", "Help"]);
    for id in &ids {
        assert_eq!(gate_of_opt(id).and_then(gate_engine), None, "{id} belongs to an engine");
    }
    for id in ["file:connect", "file:exit", "edit:preferences", "view:refresh_all", "view:zoom_in", "help:about"] {
        assert!(ids.contains(&id), "{id} should survive with no engine");
    }
}

#[test]
fn menu_scope_reads_the_frontends_engine_ids() {
    assert_eq!(menu_scope_from_id("mongodb"), MenuScope::Engine(MenuEngine::MongoDb));
    assert_eq!(menu_scope_from_id("postgresql"), MenuScope::Engine(MenuEngine::Postgres));
    assert_eq!(menu_scope_from_id("none"), MenuScope::Neutral);
    // An id this build has no items for shows neither engine.
    assert_eq!(menu_scope_from_id("mysql"), MenuScope::Neutral);
}
