// PostgreSQL workspace definitions. A table tab's settings live in its tableSession
// while it's open; they're saved as `view`, and a restored tab starts from them
// (`restoredView`). Rows and results are never saved — they load again.
import PostgresTableWorkspace from './PostgresTableWorkspace.vue'
import PostgresQueryWorkspace from './PostgresQueryWorkspace.vue'
import { createResourceRef } from '../../../utils/resourceRef'
import { peekTableSession, dropTableSession } from './tableSessions.js'

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
    // A tab restored but never opened has no session yet; its restored view stands.
    serialize: (workspace) => {
      const view = peekTableSession(workspace.id)?.snapshot() ?? workspace.restoredView
      return view ? { view: JSON.parse(JSON.stringify(view)) } : {}
    },
    restore: (saved) => {
      const restored = tableWorkspace(saved)
      return { ...restored, fields: { ...restored.fields, restoredView: saved.view ?? null } }
    },
    dispose: (workspace) => dropTableSession(workspace.id),
  },
  {
    type: 'postgresql.query',
    engine: 'postgresql',
    component: PostgresQueryWorkspace,
    create: (ctx) => queryWorkspace(ctx.target),
    duplicate: (workspace) => queryWorkspace(workspace),
    serialize: (workspace) => ({ sql: workspace.sql }),
    restore: (saved) => queryWorkspace(saved),
  },
]
