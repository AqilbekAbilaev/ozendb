// PostgreSQL workspace definitions. A tab is plain data: what the user built as `state`,
// a table tab's panel as `ui`, and what it loaded or is running as `runtime`
// (tableState.js). A session saves the state; runtime starts fresh and loads again.
import PostgresTableWorkspace from './PostgresTableWorkspace.vue'
import PostgresQueryWorkspace from './PostgresQueryWorkspace.vue'
import PostgresSearchWorkspace from './PostgresSearchWorkspace.vue'
import { createResourceRef } from '../../../utils/resourceRef'
import { createTableState, createTableUi, createTableRuntime, migrateTableState } from './tableState.js'
import { abandonTransaction, createSqlRun } from './runSql.js'
import { createSearchState, createSearchRuntime, cancelSearch } from './searchRun.js'
import { showToast } from '../../../stores/toast'

// A closing tab can't ask first (closes are synchronous), so the safe side wins:
// its open transaction is rolled back, and a message says so.
async function rollBackOnClose(run) {
  if (await abandonTransaction(run)) showToast('The closed tab had a transaction open; it was rolled back.')
}

// Tabs are reactive, which structuredClone can't copy; state and ui are JSON-only.
const copy = (value) => JSON.parse(JSON.stringify(value))

function tableWorkspace({ connectionId, connectionName, database, schema, table }, state = createTableState(), ui = createTableUi()) {
  return {
    title: table,
    target: createResourceRef(connectionId, [
      { kind: 'database', name: database },
      { kind: 'schema', name: schema },
      { kind: 'table', name: table },
    ]),
    fields: {
      kind: 'pgTable', connectionId, connectionName, database, schema, table,
      state, ui, runtime: createTableRuntime(connectionId),
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
      runtime: { run: createSqlRun(connectionId, database) },
    },
  }
}

// The typed search is the tab's state; its result is runtime, so a duplicate or a
// restored tab starts without one (#180).
function searchWorkspace({ connectionId, connectionName, database, schema }, state = createSearchState()) {
  return {
    title: 'Search: ' + schema,
    target: createResourceRef(connectionId, [
      { kind: 'database', name: database },
      { kind: 'schema', name: schema },
    ]),
    fields: {
      kind: 'pgSearch', connectionId, connectionName, database, schema,
      state, runtime: createSearchRuntime(),
    },
  }
}

export const postgresDefinitions = [
  {
    type: 'postgresql.table_browse',
    engine: 'postgresql',
    component: PostgresTableWorkspace,
    create: (ctx) => tableWorkspace(ctx.target, createTableState({ rowKey: ctx.options?.rowKey })),
    // Filter mode only reads; SQL mode runs whatever SQL the user wrote.
    canRefresh: (workspace) => workspace.state.mode === 'filter',
    // A copy keeps the query and the panel; rows load again.
    duplicate: (workspace) => tableWorkspace(workspace, copy(workspace.state), copy(workspace.ui)),
    serialize: (workspace) => copy({ state: workspace.state, ui: workspace.ui }),
    restore: (saved) => tableWorkspace(saved, migrateTableState(saved), { ...createTableUi(), ...saved.ui }),
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
  {
    type: 'postgresql.search',
    engine: 'postgresql',
    component: PostgresSearchWorkspace,
    create: (ctx) => searchWorkspace(ctx.target),
    duplicate: (workspace) => searchWorkspace(workspace, copy(workspace.state)),
    serialize: (workspace) => copy({ state: workspace.state }),
    restore: (saved) => searchWorkspace(saved, { ...createSearchState(), ...saved.state }),
    dispose: (workspace) => cancelSearch(workspace),
  },
]
