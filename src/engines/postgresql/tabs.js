import { openWorkspaceTab, newWorkspaceTab, showWorkspaceTab } from '../../stores/tabCreators'

// PostgreSQL's "open a tab" entry points, built on the shared helpers in stores/tabCreators.js.

// A PostgreSQL table, like a MongoDB collection, opens a new tab every time; `rowKey`
// (a row's primary key) opens it filtered to that row.
export function openPostgresTable({ connectionId, connectionName, database, schema, table, rowKey }) {
  openWorkspaceTab('postgresql.table_browse', {
    target: { connectionId, connectionName, database, schema, table },
    options: { rowKey },
  })
}

// Search in Schema, a new tab every time, as MongoDB's Search in… is (#180).
export function openPostgresSearch({ connectionId, connectionName, database, schema }) {
  openWorkspaceTab('postgresql.search', {
    target: { connectionId, connectionName, database, schema },
  })
}

// A SQL editor against a PostgreSQL connection's database; a new tab every time.
// `sql` seeds the editor — used when a tab is opened to edit something that already
// exists, such as a function's CREATE OR REPLACE statement.
export function openPostgresQuery({ connectionId, connectionName, database, sql = '' }) {
  const tab = newWorkspaceTab('postgresql.query', { target: { connectionId, connectionName, database } })
  if (sql) tab.state.sql = sql
  showWorkspaceTab(tab)
}
