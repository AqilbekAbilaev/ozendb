// PostgreSQL workspace definitions. Tabs aren't restored after a restart yet: the
// session restore bridge only knows MongoDB's tab kinds.
import PostgresTableWorkspace from './PostgresTableWorkspace.vue'
import PostgresQueryWorkspace from './PostgresQueryWorkspace.vue'
import { createResourceRef } from '../../../utils/resourceRef'

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
  },
  {
    type: 'postgresql.query',
    engine: 'postgresql',
    component: PostgresQueryWorkspace,
    create: (ctx) => queryWorkspace(ctx.target),
    duplicate: (workspace) => queryWorkspace(workspace),
  },
]
