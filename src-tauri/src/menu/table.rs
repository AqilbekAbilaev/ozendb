use super::{Gate, Spec};

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
                Spec::Action { id: "doc:view_json", label: "View Document (JSON)…", accel: Some("F3"), gate: Some(Gate::Document) },
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
                // Webview zoom for the whole window. Always enabled — zoom applies with or
                // without a connection. `=` / `-` / `0` are the literal key names the
                // accelerator parser accepts (not "Plus"), and they're also what
                // `event.key` reports, so the same string drives the JS handler on Linux.
                Spec::Action { id: "view:zoom_in", label: "Zoom In", accel: Some("CmdOrCtrl+="), gate: None },
                Spec::Action { id: "view:zoom_out", label: "Zoom Out", accel: Some("CmdOrCtrl+-"), gate: None },
                Spec::Action { id: "view:zoom_reset", label: "Actual Size", accel: Some("CmdOrCtrl+0"), gate: None },
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
                Spec::Action { id: "help:report_problem", label: "Report a Problem…", accel: None, gate: None },
                Spec::Action { id: "help:support", label: "Contact Support", accel: None, gate: None },
                Spec::Action { id: "help:feature_request", label: "Submit a Feature Request", accel: None, gate: None },
                Spec::Action { id: "help:feedback", label: "Submit Feedback", accel: None, gate: None },
                Spec::Action { id: "help:tutorials", label: "In-app Tutorials", accel: None, gate: None },
                Spec::Action { id: "help:knowledge_base", label: "Knowledge Base", accel: None, gate: None },
            ],
        ),
    ]
}
