import { openPostgresQuery, openPostgresTable } from '../../../stores/tabCreators'
import { openModal } from '../../../stores/modals'

// The right-click menus for PostgreSQL's sidebar rows, in the same shape as
// constants/contextMenus.js. A node here is `{ connId, connName, engine, database,
// schema?, table? }`. PG_ACTIONS runs the PostgreSQL-only items; every other label
// (Copy Name, Refresh, Choose Color, Disconnect…) is the shared handler in
// useFeatures, which works the same for either engine.
const REFRESH = { label: 'Refresh' }
const COPY_NAME = { label: 'Copy Name', shortcut: '⌥⌘C' }
const NEW_SQL = { label: 'New SQL Query', icon: 'sql' }
const ROUTINES = { label: 'Functions & Procedures…', icon: 'aggregate' }

export const PG_MENUS = {
  connection: [
    NEW_SQL,
    { sep: true },
    { label: 'Server Info', icon: 'info' },
    { label: 'Server Activity…', icon: 'clock' },
    { label: 'Roles…', icon: 'connect' },
    { sep: true },
    COPY_NAME,
    { sep: true },
    REFRESH,
    { label: 'Choose Color', icon: 'brush', sub: 'color' },
    { sep: true },
    { label: 'Disconnect', shortcut: '⌃⌥D' },
    { label: 'Disconnect Others' },
    { label: 'Disconnect All' },
  ],
  database: [NEW_SQL, ROUTINES, { sep: true }, COPY_NAME, { sep: true }, REFRESH],
  schema: [ROUTINES, { sep: true }, COPY_NAME, { sep: true }, REFRESH],
  table: [{ label: 'Open Table', icon: 'table', shortcut: '↵' }, NEW_SQL, { sep: true }, COPY_NAME],
}

export const PG_ACTIONS = {
  'Server Info': (n) => openModal('pgServerInfo', n),
  'Server Activity…': (n) => openModal('pgActivity', n),
  'Roles…': (n) => openModal('pgRoles', n),
  'Functions & Procedures…': (n) => openModal('pgRoutines', n),
  'New SQL Query': (n) => openPostgresQuery({ connectionId: n.connId, connectionName: n.connName, database: n.database }),
  'Open Table': (n) => openPostgresTable({
    connectionId: n.connId, connectionName: n.connName, database: n.database, schema: n.schema, table: n.table,
  }),
}
