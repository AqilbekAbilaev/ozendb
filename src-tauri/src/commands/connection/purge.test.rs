use super::*;
use crate::collection_history::HistoryEntry;
use crate::commands::postgres::ColumnValue;
use crate::default_queries::DefaultQuery;
use crate::history::QueryHistoryEntry;
use crate::postgres::row_history::PgHistoryEntry;
use tempfile::tempdir;

const GONE: &str = "gone-conn";
const KEPT: &str = "kept-conn";

struct Stores {
    _dir: tempfile::TempDir,
    node_tags: NodeTagStorage,
    query_history: HistoryStorage,
    default_queries: DefaultQueryStorage,
    export_watermarks: ExportWatermarkStorage,
    shell_history: ShellHistoryStorage,
    collection_history: CollectionHistoryStore,
    pg_row_history: PgRowHistoryStore,
    pg_queries: PgQueryLibraryStore,
}

impl Stores {
    fn new() -> Self {
        let dir = tempdir().unwrap();
        let path = |name: &str| dir.path().join(name);
        Stores {
            node_tags: NodeTagStorage::new(path("node_tags.json")),
            query_history: HistoryStorage::new(path("history.json")),
            default_queries: DefaultQueryStorage::new(path("default_queries.json")),
            export_watermarks: ExportWatermarkStorage::new(path("export_watermarks.json")),
            shell_history: ShellHistoryStorage::new(path("shell_history.json")),
            collection_history: CollectionHistoryStore::new(path("collection_history.json")),
            pg_row_history: PgRowHistoryStore::new(path("pg_row_history.json")),
            pg_queries: PgQueryLibraryStore::new(path("pg_queries.json")),
            _dir: dir,
        }
    }

    fn data(&self) -> ConnectionData<'_> {
        ConnectionData {
            node_tags: &self.node_tags,
            query_history: &self.query_history,
            default_queries: &self.default_queries,
            export_watermarks: &self.export_watermarks,
            shell_history: &self.shell_history,
            collection_history: &self.collection_history,
            pg_row_history: &self.pg_row_history,
            pg_queries: &self.pg_queries,
        }
    }

    // One entry per store under `conn`, keyed exactly as the commands that write
    // them key it.
    fn fill(&self, conn: &str) {
        self.node_tags.set(&format!("{conn}/db"), "blue").unwrap();
        self.query_history.push(&format!("{conn}::db::coll"), query(conn)).unwrap();
        self.default_queries.set(&format!("{conn}::db::coll"), default_query()).unwrap();
        self.export_watermarks.set(&format!("{conn}/db/coll"), "{\"$oid\":\"x\"}").unwrap();
        self.shell_history.push(conn, String::from("db.coll.find()")).unwrap();
        self.collection_history.push(document_change(conn)).unwrap();
        self.pg_row_history.push(row_change(conn)).unwrap();
        self.pg_queries.push_history(conn, "SELECT 1", "now").unwrap();
        self.pg_queries.save(&format!("{conn}-saved"), "q", conn, "SELECT 2", "now").unwrap();
    }

    fn holds(&self, conn: &str) -> Vec<&'static str> {
        let mut found = Vec::new();
        if self.node_tags.load().keys().any(|k| k.starts_with(&format!("{conn}/"))) {
            found.push("node_tags");
        }
        if !self.query_history.get(&format!("{conn}::db::coll")).is_empty() {
            found.push("query_history");
        }
        if self.default_queries.get(&format!("{conn}::db::coll")).is_some() {
            found.push("default_queries");
        }
        if self.export_watermarks.get(&format!("{conn}/db/coll")).is_some() {
            found.push("export_watermarks");
        }
        if !self.shell_history.get(conn).is_empty() {
            found.push("shell_history");
        }
        if !self.collection_history.list_for(conn, "db", "coll").is_empty() {
            found.push("collection_history");
        }
        if !self.pg_row_history.list_for(conn, "db", "public", "t").is_empty() {
            found.push("pg_row_history");
        }
        if !self.pg_queries.history(conn).is_empty() {
            found.push("pg_queries history");
        }
        if !self.pg_queries.saved(conn).is_empty() {
            found.push("pg_queries saved");
        }
        found
    }
}

fn query(conn: &str) -> QueryHistoryEntry {
    QueryHistoryEntry {
        id: format!("{conn}-q"),
        mode: String::from("find"),
        filter: String::from("{}"),
        sort: String::from("{}"),
        projection: String::from("{}"),
        skip: 0,
        limit: 20,
        pipeline: String::from("[]"),
        ran_at: String::from("now"),
    }
}

fn default_query() -> DefaultQuery {
    DefaultQuery {
        mode: String::from("find"),
        filter: String::from("{}"),
        sort: String::from("{}"),
        projection: String::from("{}"),
        skip: 0,
        limit: 20,
        pipeline: String::from("[]"),
    }
}

fn document_change(conn: &str) -> HistoryEntry {
    HistoryEntry {
        id: format!("{conn}-doc"),
        conn_id: conn.to_string(),
        database: String::from("db"),
        collection: String::from("coll"),
        op: String::from("update"),
        at: 0,
        doc_id: String::from("{\"$oid\":\"x\"}"),
        before: Some(String::from("{\"secret\":\"pre-image\"}")),
    }
}

fn row_change(conn: &str) -> PgHistoryEntry {
    PgHistoryEntry {
        id: format!("{conn}-row"),
        conn_id: conn.to_string(),
        database: String::from("db"),
        schema: String::from("public"),
        table: String::from("t"),
        at: 0,
        key: vec![ColumnValue { column: String::from("id"), value: serde_json::json!(1) }],
        changes: Vec::new(),
    }
}

#[test]
fn purge_empties_every_store_of_that_connection() {
    let stores = Stores::new();
    stores.fill(GONE);
    assert_eq!(stores.holds(GONE).len(), 9, "the fixture should fill every store");

    stores.data().purge(GONE);

    assert_eq!(stores.holds(GONE), Vec::<&str>::new());
}

#[test]
fn purge_leaves_other_connections_alone() {
    let stores = Stores::new();
    stores.fill(GONE);
    stores.fill(KEPT);

    stores.data().purge(GONE);

    assert_eq!(stores.holds(KEPT).len(), 9);
}

#[test]
fn a_shared_id_prefix_is_not_a_match() {
    // "gone-conn-2" starts with "gone-conn"; the separator in each key keeps it safe.
    let stores = Stores::new();
    stores.fill("gone-conn-2");

    stores.data().purge(GONE);

    assert_eq!(stores.holds("gone-conn-2").len(), 9);
}
