// Guard against a subtle async bug: holding a synchronous `std::sync::Mutex`
// (or `RwLock`) guard across an `.await` can stall or deadlock the runtime. The
// stores here are deliberately written to lock-clone-drop *before* awaiting; this
// lint keeps that invariant from silently regressing as new async code is added.
// `deny` (not `warn`) so a regression fails `cargo clippy` outright instead of
// being lost among the crate's other (intentional, house-style) lint warnings.
#![deny(clippy::await_holding_lock)]

mod commands;
mod collection_history;
mod default_queries;
mod error;
mod export_watermarks;
mod folders;
mod history;
mod keybindings;
#[cfg(test)]
mod integration_tests;
mod json_store;
mod keychain;
mod known_hosts;
mod menu;
mod node_tags;
mod operations;
mod persist;
mod pool;
mod saved_queries;
mod settings;
mod shell;
mod ssh;
mod shell_history;
mod storage;
mod tabs;

mod time;
mod uri;

use commands::*;
use collection_history::CollectionHistoryStore;
use default_queries::DefaultQueryStorage;
use export_watermarks::ExportWatermarkStorage;
use folders::FolderStorage;
use history::HistoryStorage;
use keybindings::KeybindingStorage;
use known_hosts::KnownHostsStore;
use node_tags::NodeTagStorage;
use operations::OperationsRegistry;
use pool::ConnectionPool;
use std::sync::Arc;
use saved_queries::SavedQueryStorage;
use settings::SettingsStorage;
use shell::ShellEngine;
use shell_history::ShellHistoryStorage;
use storage::Storage;
use tabs::TabStorage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = match app.path().app_data_dir() {
                Ok(val) => val,
                Err(e) => return Err(e.into()),
            };
            app.manage(FolderStorage::new(data_dir.join("folders.json")));
            app.manage(HistoryStorage::new(data_dir.join("history.json")));
            app.manage(SavedQueryStorage::new(data_dir.join("saved_queries.json")));
            app.manage(DefaultQueryStorage::new(data_dir.join("default_queries.json")));
            app.manage(SettingsStorage::new(data_dir.join("settings.json")));
            app.manage(TabStorage::new(data_dir.join("tabs.json")));
            app.manage(NodeTagStorage::new(data_dir.join("node_tags.json")));
            app.manage(KeybindingStorage::new(data_dir.join("keybindings.json")));
            app.manage(ExportWatermarkStorage::new(data_dir.join("export_watermarks.json")));
            app.manage(CollectionHistoryStore::new(data_dir.join("collection_history.json")));
            // The host-key trust store is shared between the pool (real connect)
            // and the test_ssh_connection command, so both honor the same TOFU
            // record. Managed as an Arc so the pool can own a clone.
            let known_hosts = Arc::new(KnownHostsStore::new(data_dir.join("known_hosts.json")));
            app.manage(Arc::clone(&known_hosts));
            // Broker for interactive first-contact host-key prompts; shared with
            // the pool so a tunnel established on connect can raise the prompt.
            let host_key_prompts = Arc::new(ssh::HostKeyPrompts::new());
            app.manage(Arc::clone(&host_key_prompts));
            let pool = ConnectionPool::new(
                Arc::clone(&known_hosts),
                Arc::clone(&host_key_prompts),
                app.handle().clone(),
            );
            let storage = Storage::new(data_dir.join("connections.json"));
            app.manage(AppContext { pool: pool, storage: storage });
            app.manage(ShellEngine::new());
            app.manage(ShellHistoryStorage::new(
                data_dir.join("shell_history.json"),
            ));
            // The single source of truth for the Operations pane; holds the app
            // handle so it can announce changes via the `operations-changed` event.
            app.manage(OperationsRegistry::new(
                data_dir.join("operations.json"),
                app.handle().clone(),
            ));

            // The main window is built here rather than auto-created from the config
            // (hence `"create": false` there) because clipboard access is a builder-only
            // option: without it WebKitGTK leaves `javascript-can-access-clipboard` off
            // and every `navigator.clipboard.writeText` in the app rejects with
            // NotAllowedError — silently, since a copy has nothing to fall back on.
            let main_config = match app.config().app.windows.iter().find(|w| w.label == "main") {
                Some(val) => val.clone(),
                None => return Err("no main window in the config".into()),
            };
            let main_builder =
                match tauri::WebviewWindowBuilder::from_config(app.handle(), &main_config) {
                    Ok(val) => val,
                    Err(e) => return Err(e.into()),
                };
            match main_builder.enable_clipboard_access().build() {
                Ok(_val) => {}
                Err(e) => return Err(e.into()),
            };

            // Install the native OS menu (macOS system menu bar; native in-window
            // menu on Windows/Linux). Item clicks are emitted to the frontend,
            // which routes them through the existing handlers. The gated item
            // handles are kept in managed state so `set_menu_context` can toggle
            // their enabled flag as the selection changes.
            // Custom shortcut accelerators (empty = built-in defaults). Read once
            // here so the native menu is built with the user's bindings; a rebind
            // made later takes effect on the next launch.
            let key_overrides = app.state::<KeybindingStorage>().load();
            let (native_menu, gated_items) = match menu::build(app.handle(), &key_overrides) {
                Ok(val) => val,
                Err(e) => return Err(e.into()),
            };
            // Scope the menu to the main window so the pop-out document windows
            // don't get their own native menu bar.
            let main_window = match app.get_webview_window("main") {
                Some(val) => val,
                None => return Err("no main window to attach the menu to".into()),
            };
            match main_window.set_menu(native_menu) {
                Ok(_val) => {}
                Err(e) => return Err(e.into()),
            };
            app.manage(menu::MenuItems(std::sync::Mutex::new(gated_items)));
            app.on_menu_event(menu::handle_event);

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            test_connection,
            test_ssh_connection,
            respond_ssh_host_key,
            forget_ssh_host,
            save_connection,
            update_connection,
            list_connections,
            delete_connection,
            disconnect,
            set_connection_open,
            set_connection_tag,
            update_last_accessed,
            open_document_window,
            list_databases,
            create_collection,
            drop_database,
            drop_collection,
            rename_collection,
            create_database,
            find_documents,
            count_documents,
            kill_query,
            server_status,
            database_stats,
            current_ops,
            get_profiling_status,
            set_profiling_level,
            list_profile,
            create_view,
            get_validator,
            set_validator,
            connection_uri,
            duplicate_connection,
            export_connections,
            import_connections,
            get_settings,
            update_settings,
            get_keybindings,
            update_keybindings,
            insert_document,
            insert_documents,
            replace_document,
            delete_document,
            update_many,
            delete_many,
            clear_collection,
            explain_query,
            explain_aggregate,
            list_indexes,
            create_index,
            drop_index,
            set_index_hidden,
            index_stats,
            run_aggregate,
            export_collection,
            import_collection,
            import_collection_mapped,
            export_collection_fields,
            import_preview,
            stage_import_text,
            can_self_update,
            get_default_query,
            set_default_query,
            clear_default_query,
            get_open_tabs,
            set_open_tabs,
            get_node_tags,
            set_node_tag,
            clear_node_tags_under,
            list_saved_queries,
            save_query,
            delete_saved_query,
            get_query_history,
            push_query_history,
            clear_query_history,
            run_shell_command,
            close_shell_session,
            get_shell_history,
            push_shell_command,
            clear_shell_history,
            read_shell_script,
            write_shell_script,
            analyze_schema,
            export_schema,
            list_collection_history,
            clear_collection_history,
            restore_history,
            translate_sql,
            collection_stats,
            duplicate_collection,
            server_info,
            search_collections,
            list_gridfs_buckets,
            list_gridfs_files,
            gridfs_upload,
            gridfs_download,
            gridfs_delete,
            gridfs_rename,
            gridfs_set_metadata,
            gridfs_drop_bucket,
            gridfs_copy_bucket,
            list_users,
            create_user,
            copy_users_to_connection,
            drop_user,
            list_roles,
            list_functions,
            save_function,
            drop_function,
            map_reduce,
            copy_collection,
            copy_collection_to_connection,
            list_folders,
            create_folder,
            rename_folder,
            delete_folder,
            move_connection_to_folder,
            list_operations,
            clear_operations,
            menu::set_menu_context,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
