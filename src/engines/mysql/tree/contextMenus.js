import { openMySqlQuery, openMySqlTable } from '../../../stores/tabCreators'
import { openModal } from '../../../stores/modals'
import { resourceName, segmentName } from '../../../utils/resourceRef'
import { CHOOSE_COLOR, COPY_NAME, DISCONNECT, REFRESH_NODE } from '../../../constants/contextMenus'

// The right-click menus for MySQL's sidebar rows, in the same shape as PostgreSQL's
// (postgresql/tree/contextMenus.js). A node here is `{ connId, connName, engine, resource }`,
// with the `kind` of view or stored program a row below a table names.
// MYSQL_ACTIONS runs the MySQL-only items; the shared ones are handled by useFeatures.
// A database or table row has no Choose Color yet, as the colour store keys rows by
// engine-specific menu type.
const NEW_SQL = { value: 'mysql:new_sql', label: 'New SQL Query', icon: 'sql' }
const DEFINITION = { value: 'mysql:definition', label: 'Show Definition', icon: 'expr' }

export const MYSQL_MENUS = {
  connection: [
    NEW_SQL,
    { sep: true },
    { value: 'mysql:server_info', label: 'Server Info', icon: 'info' },
    { value: 'mysql:activity', label: 'Server Activity…', icon: 'clock' },
    { value: 'mysql:users', label: 'Users…', icon: 'connect' },
    { sep: true },
    COPY_NAME,
    { sep: true },
    REFRESH_NODE,
    CHOOSE_COLOR,
    { sep: true },
    ...DISCONNECT,
  ],
  database: [NEW_SQL, { sep: true }, COPY_NAME, { sep: true }, REFRESH_NODE],
  table: [
    { value: 'mysql:open_table', label: 'Open Table', icon: 'table' }, NEW_SQL,
    { sep: true }, { value: 'mysql:export_table', label: 'Export Table…', icon: 'export' }, { value: 'mysql:import_csv', label: 'Import CSV…', icon: 'import' },
    { sep: true }, COPY_NAME,
  ],
  view: [{ value: 'mysql:open_table', label: 'Open View', icon: 'table' }, DEFINITION, NEW_SQL, { sep: true }, COPY_NAME],
  // A procedure, function, trigger or event.
  program: [DEFINITION, NEW_SQL, { sep: true }, COPY_NAME],
}

// A table row as the shared SQL windows (engines/sql/admin) take it, naming the table's
// database its `schema`, as the table tab does.
const tableTarget = (n) => ({ connId: n.connId, engine: n.engine, schema: segmentName(n.resource, 'database'), table: resourceName(n.resource) })

export const MYSQL_ACTIONS = {
  'mysql:open_table': (n) => openMySqlTable({ resource: n.resource, connectionName: n.connName }),
  'mysql:new_sql': (n) => openMySqlQuery({ resource: n.resource, connectionName: n.connName }),
  'mysql:definition': (n) => openModal('mysqlDefinition', n),
  'mysql:export_table': (n) => openModal('sqlExport', tableTarget(n)),
  'mysql:import_csv': (n) => openModal('sqlImport', tableTarget(n)),
  'mysql:server_info': (n) => openModal('mysqlServerInfo', n),
  'mysql:activity': (n) => openModal('mysqlActivity', n),
  'mysql:users': (n) => openModal('mysqlUsers', n),
}
