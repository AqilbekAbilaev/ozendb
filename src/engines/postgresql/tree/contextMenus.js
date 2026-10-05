import { openPostgresQuery, openPostgresTable } from '../../../stores/tabCreators'
import { openModal } from '../../../stores/modals'

// The right-click menus for PostgreSQL's sidebar rows, in the same shape as
// constants/contextMenus.js: `value` is the action id, `label` only what shows. A node
// here is `{ connId, connName, engine, database, schema?, table? }`. PG_ACTIONS runs the
// PostgreSQL-only items; every other id (Copy Name, Refresh, Choose Color, Disconnect…)
// is the shared handler in useFeatures, which works the same for either engine.
const REFRESH = { value: 'node:refresh', label: 'Refresh' }
const COPY_NAME = { value: 'node:copy_name', label: 'Copy Name', shortcut: '⌥⌘C' }
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
    REFRESH,
    { label: 'Choose Color', icon: 'brush', sub: 'color' },
    { sep: true },
    { value: 'conn:disconnect', label: 'Disconnect', shortcut: '⌃⌥D' },
    { value: 'conn:disconnect_others', label: 'Disconnect Others' },
    { value: 'conn:disconnect_all', label: 'Disconnect All' },
  ],
  database: [NEW_SQL, ROUTINES, { sep: true }, { value: 'pg:create_schema', label: 'Create Schema…' }, { sep: true }, COPY_NAME, { sep: true }, REFRESH],
  schema: [
    ROUTINES, { value: 'pg:search_schema', label: 'Search in Schema…', icon: 'search' },
    { sep: true }, { value: 'pg:create_table', label: 'Create Table…', icon: 'table' }, { value: 'pg:drop_schema', label: 'Drop Schema…' },
    { sep: true }, COPY_NAME, { sep: true }, REFRESH,
  ],
  table: [
    { value: 'pg:open_table', label: 'Open Table', icon: 'table', shortcut: '↵' }, NEW_SQL,
    { sep: true }, { value: 'pg:export_table', label: 'Export Table…', icon: 'export' }, { value: 'pg:import_csv', label: 'Import CSV…', icon: 'import' },
    { sep: true }, { value: 'pg:rename_table', label: 'Rename Table…' }, { value: 'pg:drop_table', label: 'Drop Table…' },
    { sep: true }, COPY_NAME,
  ],
}

export const PG_ACTIONS = {
  'pg:server_info': (n) => openModal('pgServerInfo', n),
  'pg:activity': (n) => openModal('pgActivity', n),
  'pg:roles': (n) => openModal('pgRoles', n),
  'pg:routines': (n) => openModal('pgRoutines', n),
  'pg:search_schema': (n) => openModal('pgSearch', n),
  'pg:create_schema': (n) => openModal('pgCreateSchema', n),
  'pg:drop_schema': (n) => openModal('pgDrop', n),
  'pg:create_table': (n) => openModal('pgCreateTable', n),
  'pg:rename_table': (n) => openModal('pgRenameTable', n),
  'pg:drop_table': (n) => openModal('pgDrop', n),
  'pg:export_table': (n) => openModal('pgExport', n),
  'pg:import_csv': (n) => openModal('pgImport', n),
  'pg:new_sql': (n) => openPostgresQuery({ connectionId: n.connId, connectionName: n.connName, database: n.database }),
  'pg:open_table': (n) => openPostgresTable({
    connectionId: n.connId, connectionName: n.connName, database: n.database, schema: n.schema, table: n.table,
  }),
}
