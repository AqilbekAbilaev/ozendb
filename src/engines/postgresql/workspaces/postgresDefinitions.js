// PostgreSQL workspace definitions. Tabs aren't restored after a restart yet: the
// session restore bridge only knows MongoDB's tab kinds.
import PostgresTableWorkspace from './PostgresTableWorkspace.vue'
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

export const postgresDefinitions = [
  {
    type: 'postgresql.table_browse',
    engine: 'postgresql',
    component: PostgresTableWorkspace,
    create: (ctx) => tableWorkspace(ctx.target),
    duplicate: (workspace) => tableWorkspace(workspace),
  },
]
