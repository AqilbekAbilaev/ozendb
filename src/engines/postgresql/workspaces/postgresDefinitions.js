// PostgreSQL workspace definitions. A table tab's settings live in its tableSession
// while it's open; they're saved as `state` (tableState.js), and a restored tab starts
// from them (`restoredState`). Rows and results are never saved — they load again.
import PostgresTableWorkspace from './PostgresTableWorkspace.vue'
import PostgresQueryWorkspace from './PostgresQueryWorkspace.vue'
import { createResourceRef } from '../../../utils/resourceRef'
import { peekTableSession, dropTableSession } from './tableSessions.js'
import { migrateTableState } from './tableState.js'
import { abandonTransaction } from './runSql.js'
import { showToast } from '../../../stores/toast'

// A closing tab can't ask first (closes are synchronous), so the safe side wins:
// its open transaction is rolled back, and a message says so.
async function rollBackOnClose(state) {
  if (state && await abandonTransaction(state)) showToast('The closed tab had a transaction open; it was rolled back.')
}

function tableWorkspace({ connectionId, connectionName, database, schema, table }) {
  return {
    title: table,
    target: createResourceRef(connectionId, [
      { kind: 'database', name: database },
      { kind: 'schema', name: schema },
      { kind: 'table', name: table },
    ]),
    fields: { kind: 'pgTable', connectionId, connectionName, database, schema, table },
  }
}

// The result is runtime state kept on the tab, so a duplicate starts without one.
function queryWorkspace({ connectionId, connectionName, database, sql = '' }) {
  return {
    title: 'SQL: ' + database,
    target: createResourceRef(connectionId, [{ kind: 'database', name: database }]),
    fields: { kind: 'pgQuery', connectionId, connectionName, database, sql, result: null, error: null, running: false },
  }
}

export const postgresDefinitions = [
  {
    type: 'postgresql.table_browse',
    engine: 'postgresql',
    component: PostgresTableWorkspace,
    create: (ctx) => tableWorkspace(ctx.target),
    duplicate: (workspace) => tableWorkspace(workspace),
    // A tab restored but never opened has no session yet; its restored state stands.
    serialize: (workspace) => {
      const state = peekTableSession(workspace.id)?.snapshot() ?? workspace.restoredState
      return state ? { state: JSON.parse(JSON.stringify(state)) } : {}
    },
    restore: (saved) => {
      const restored = tableWorkspace(saved)
      return { ...restored, fields: { ...restored.fields, restoredState: migrateTableState(saved) } }
    },
    dispose: (workspace) => {
      const state = peekTableSession(workspace.id)?.sqlState
      dropTableSession(workspace.id)
      return rollBackOnClose(state)
    },
  },
  {
    type: 'postgresql.query',
    engine: 'postgresql',
    component: PostgresQueryWorkspace,
    create: (ctx) => queryWorkspace(ctx.target),
    duplicate: (workspace) => queryWorkspace(workspace),
    serialize: (workspace) => ({ sql: workspace.sql }),
    restore: (saved) => queryWorkspace(saved),
    dispose: (workspace) => rollBackOnClose(workspace),
  },
]
