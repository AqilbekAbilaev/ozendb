import { openMySqlTable } from '../../../stores/tabCreators'
import { CHOOSE_COLOR, COPY_NAME, DISCONNECT, REFRESH_NODE } from '../../../constants/contextMenus'

// The right-click menus for MySQL's sidebar rows, in the same shape as PostgreSQL's
// (postgresql/tree/contextMenus.js). A node here is `{ connId, connName, engine, resource }`.
// MYSQL_ACTIONS runs the MySQL-only items; the shared ones are handled by useFeatures.
// A query tab comes with #391. A database or table row has no Choose Color yet, as the
// colour store keys rows by engine-specific menu type.
export const MYSQL_MENUS = {
  connection: [COPY_NAME, { sep: true }, REFRESH_NODE, CHOOSE_COLOR, { sep: true }, ...DISCONNECT],
  database: [COPY_NAME, { sep: true }, REFRESH_NODE],
  table: [{ value: 'mysql:open_table', label: 'Open Table', icon: 'table' }, { sep: true }, COPY_NAME],
}

export const MYSQL_ACTIONS = {
  'mysql:open_table': (n) => openMySqlTable({ resource: n.resource, connectionName: n.connName }),
}
