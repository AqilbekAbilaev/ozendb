import { openWorkspaceTab, newWorkspaceTab, showWorkspaceTab } from '../../stores/tabCreators'

// MySQL's "open a tab" entry points, built on the shared helpers in stores/tabCreators.js.
// MariaDB shares them: the caller passes its `engine` ('mysql' or 'mariadb'), which names the tab's type.

// A MySQL table, a new tab every time, on its `database/table` ref.
export function openMySqlTable({ engine, resource, connectionName }) {
  openWorkspaceTab(`${engine}.table_browse`, { target: { resource, connectionName } })
}

// A SQL editor in the database of a MySQL row (any database, table or stored program's
// row, or the connection's for its own row), holding `sql`; a new tab every time.
export function openMySqlQuery({ engine, resource, connectionName, sql = '' }) {
  const tab = newWorkspaceTab(`${engine}.query`, { target: { resource, connectionName } })
  if (sql) tab.state.sql = sql
  showWorkspaceTab(tab)
}
