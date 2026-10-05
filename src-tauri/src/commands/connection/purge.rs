use crate::collection_history::CollectionHistoryStore;
use crate::default_queries::DefaultQueryStorage;
use crate::export_watermarks::ExportWatermarkStorage;
use crate::history::HistoryStorage;
use crate::node_tags::NodeTagStorage;
use crate::pg_query_library::PgQueryLibraryStore;
use crate::pg_row_history::PgRowHistoryStore;
use crate::shell_history::ShellHistoryStorage;
use tauri::{AppHandle, Manager};

/// Every store that keeps data under a connection's id. A new one belongs here, or
/// deleting a connection leaves its data on disk.
pub(crate) struct ConnectionData<'a> {
    pub node_tags: &'a NodeTagStorage,
    pub query_history: &'a HistoryStorage,
    pub default_queries: &'a DefaultQueryStorage,
    pub export_watermarks: &'a ExportWatermarkStorage,
    pub shell_history: &'a ShellHistoryStorage,
    pub collection_history: &'a CollectionHistoryStore,
    pub pg_row_history: &'a PgRowHistoryStore,
    pub pg_queries: &'a PgQueryLibraryStore,
}

impl<'a> ConnectionData<'a> {
    pub(crate) fn from_app(app: &'a AppHandle) -> Self {
        ConnectionData {
            node_tags: app.state::<NodeTagStorage>().inner(),
            query_history: app.state::<HistoryStorage>().inner(),
            default_queries: app.state::<DefaultQueryStorage>().inner(),
            export_watermarks: app.state::<ExportWatermarkStorage>().inner(),
            shell_history: app.state::<ShellHistoryStorage>().inner(),
            collection_history: app.state::<CollectionHistoryStore>().inner(),
            pg_row_history: app.state::<PgRowHistoryStore>().inner(),
            pg_queries: app.state::<PgQueryLibraryStore>().inner(),
        }
    }

    /// Best-effort: the connection itself is already gone, so a store that fails to
    /// purge doesn't fail the delete. The failure goes to the error log instead.
    pub(crate) fn purge(&self, conn_id: &str) {
        let results = [
            self.node_tags.remove_connection(conn_id),
            self.query_history.remove_connection(conn_id),
            self.default_queries.remove_connection(conn_id),
            self.export_watermarks.remove_connection(conn_id),
            self.shell_history.remove_connection(conn_id),
            self.collection_history.remove_connection(conn_id),
            self.pg_row_history.remove_connection(conn_id),
            self.pg_queries.remove_connection(conn_id),
        ];
        for result in results {
            if let Err(e) = result {
                crate::error_log::record(e.code(), &format!("purging a deleted connection's data: {e}"));
            }
        }
    }
}

#[cfg(test)]
#[path = "purge.test.rs"]
mod tests;
