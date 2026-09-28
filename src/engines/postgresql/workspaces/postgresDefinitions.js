// PostgreSQL workspace definitions. A tab is plain data: what the user built as `state`,
// a table tab's panel as `ui`, and what it loaded or is running as `runtime`
// (tableState.js). A session saves the state; runtime starts fresh and loads again.
import PostgresTableWorkspace from './PostgresTableWorkspace.vue'
import PostgresQueryWorkspace from './PostgresQueryWorkspace.vue'
import { createResourceRef } from '../../../utils/resourceRef'
import { createTableState, createTableUi, createTableRuntime, migrateTableState, stateToSave } from './tableState.js'
import { abandonTransaction, createSqlRun } from './runSql.js'
import { showToast } from '../../../stores/toast'

// A closing tab can't ask first (closes are synchronous), so the safe side wins:
// its open transaction is rolled back, and a message says so.
async function rollBackOnClose(run) {
  if (await abandonTransaction(run)) showToast('The closed tab had a transaction open; it was rolled back.')
}

function tableWorkspace({ connectionId, connectionName, database, schema, table }, state = createTableState()) {
  return {
    title: table,
    target: createResourceRef(connectionId, [
      { kind: 'database', name: database },
      { kind: 'schema', name: schema },
      { kind: 'table', name: table },
    ]),
    fields: {
      kind: 'pgTable', connectionId, connectionName, database, schema, table,
      state, ui: createTableUi(), runtime: createTableRuntime(connectionId),
    },
  }
}

// The SQL is the tab's state; its runs are runtime, so a duplicate starts without them.
function queryWorkspace({ connectionId, connectionName, database }, sql = '') {
  return {
    title: 'SQL: ' + database,
    target: createResourceRef(connectionId, [{ kind: 'database', name: database }]),
    fields: {
      kind: 'pgQuery', connectionId, connectionName, database,
      state: { sql },
      runtime: { run: createSqlRun(connectionId) },
    },
  }
}

export const postgresDefinitions = [
  {
    type: 'postgresql.table_browse',
    engine: 'postgresql',
    component: PostgresTableWorkspace,
    create: (ctx) => tableWorkspace(ctx.target),
    duplicate: (workspace) => tableWorkspace(workspace),
    serialize: (workspace) => ({ state: stateToSave(workspace.state) }),
    restore: (saved) => tableWorkspace(saved, migrateTableState(saved)),
    dispose: (workspace) => rollBackOnClose(workspace.runtime.sqlRun),
  },
  {
    type: 'postgresql.query',
    engine: 'postgresql',
    component: PostgresQueryWorkspace,
    create: (ctx) => queryWorkspace(ctx.target),
    duplicate: (workspace) => queryWorkspace(workspace, workspace.state.sql),
    serialize: (workspace) => ({ sql: workspace.state.sql }),
    restore: (saved) => queryWorkspace(saved, saved.sql ?? ''),
    dispose: (workspace) => rollBackOnClose(workspace.runtime.run),
  },
]
