import { openPostgresQuery, openPostgresTable, openPostgresSearch } from '../../../stores/tabCreators'
import { openModal } from '../../../stores/modals'
import { CHOOSE_COLOR, COPY_NAME, DISCONNECT, REFRESH_NODE } from '../../../constants/contextMenus'

// The right-click menus for PostgreSQL's sidebar rows, in the same shape as
// constants/contextMenus.js: `value` is the action id, `label` only what shows. A node
// here is `{ connId, connName, engine, database, schema?, table?, resource }`.
// PG_ACTIONS runs the PostgreSQL-only items; every other id (Copy Name, Refresh, Choose
// Color, Disconnect…) is the shared handler in useFeatures, which reads `resource`.
const NEW_SQL = { value: 'pg:new_sql', label: 'New SQL Query', icon: 'sql' }
const ROUTINES = { value: 'pg:routines', label: 'Functions & Procedures…', icon: 'aggregate' }

export const PG_MENUS = {
  connection: [
    NEW_SQL,
    { sep: true },
    { value: 'pg:server_info', label: 'Server Info', icon: 'info' },
    { value: 'pg:activity', label: 'Server Activity…', icon: 'clock' },
    { value: 'pg:roles', label: 'Roles…', icon: 'connect' },
    { sep: true },
    COPY_NAME,
    { sep: true },
    REFRESH_NODE,
    CHOOSE_COLOR,
    { sep: true },
    ...DISCONNECT,
  ],
  database: [NEW_SQL, ROUTINES, { sep: true }, { value: 'pg:create_schema', label: 'Create Schema…' }, { sep: true }, COPY_NAME, { sep: true }, REFRESH_NODE, CHOOSE_COLOR],
  schema: [
    ROUTINES, { value: 'pg:search_schema', label: 'Search in Schema…', icon: 'search' },
    { sep: true }, { value: 'pg:create_table', label: 'Create Table…', icon: 'table' }, { value: 'pg:drop_schema', label: 'Drop Schema…' },
    { sep: true }, COPY_NAME, { sep: true }, REFRESH_NODE, CHOOSE_COLOR,
  ],
  table: [
    { value: 'pg:open_table', label: 'Open Table', icon: 'table', shortcut: '↵' }, NEW_SQL,
    { sep: true }, { value: 'pg:export_table', label: 'Export Table…', icon: 'export' }, { value: 'pg:import_csv', label: 'Import CSV…', icon: 'import' },
    { sep: true }, { value: 'pg:rename_table', label: 'Rename Table…' }, { value: 'pg:drop_table', label: 'Drop Table…' },
    { sep: true }, COPY_NAME, { sep: true }, CHOOSE_COLOR,
  ],
}

export const PG_ACTIONS = {
  'pg:server_info': (n) => openModal('pgServerInfo', n),
  'pg:activity': (n) => openModal('pgActivity', n),
  'pg:roles': (n) => openModal('pgRoles', n),
  'pg:routines': (n) => openModal('pgRoutines', n),
  'pg:search_schema': (n) => openPostgresSearch({ connectionId: n.connId, connectionName: n.connName, database: n.database, schema: n.schema }),
  'pg:create_schema': (n) => openModal('pgCreateSchema', n),
  'pg:drop_schema': (n) => openModal('pgDrop', n),
  'pg:create_table': (n) => openModal('pgCreateTable', n),
  'pg:rename_table': (n) => openModal('pgRenameTable', n),
  'pg:drop_table': (n) => openModal('pgDrop', n),
  'pg:export_table': (n) => openModal('sqlExport', n),
  'pg:import_csv': (n) => openModal('sqlImport', n),
  'pg:new_sql': (n) => openPostgresQuery({ connectionId: n.connId, connectionName: n.connName, database: n.database }),
  'pg:open_table': (n) => openPostgresTable({
    connectionId: n.connId, connectionName: n.connName, database: n.database, schema: n.schema, table: n.table,
  }),
}
