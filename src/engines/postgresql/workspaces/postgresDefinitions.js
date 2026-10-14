// PostgreSQL workspace definitions. A tab is plain data: what the user built as `state`,
// a table tab's panel as `ui`, and what it loaded or is running as `runtime`
// (tableState.js). A session saves the state; runtime starts fresh and loads again.
import { defineAsyncComponent } from 'vue'
import PostgresSearchWorkspace from './PostgresSearchWorkspace.vue'
import { createResourceRef, segmentName } from '../../../utils/resourceRef'
import { createTableState, createTableUi, createTableRuntime, migrateTableState } from './tableState.js'
import { abandonTransaction, createSqlRun } from './runSql.js'
import { createSearchState, createSearchRuntime, cancelSearch } from './searchRun.js'
import { showToast } from '../../../stores/toast'

// A closing tab can't ask first (closes are synchronous), so the safe side wins:
// its open transaction is rolled back, and a message says so.
async function rollBackOnClose(run) {
  if (await abandonTransaction(run)) showToast('The closed tab had a transaction open; it was rolled back.')
}

// Both carry the SQL editor (CodeMirror), so they load when the first tab opens rather
// than at launch. Module scope keeps each one a single component identity.
const PostgresTableWorkspace = defineAsyncComponent(() => import('./PostgresTableWorkspace.vue'))
const PostgresQueryWorkspace = defineAsyncComponent(() => import('./PostgresQueryWorkspace.vue'))

// Tabs are reactive, which structuredClone can't copy; state and ui are JSON-only.
const copy = (value) => JSON.parse(JSON.stringify(value))

// The PostgreSQL openers still pass flat fields (connectionId, database, schema, table);
// this is the one place they become the tab's ref. A tab's identity is that `target`
// alone (#303): beside it the tab keeps only the connection's display name.
function openedRef({ connectionId, database, schema, table }) {
  const segments = [{ kind: 'database', name: database }]
  if (schema) segments.push({ kind: 'schema', name: schema })
  if (table) segments.push({ kind: 'table', name: table })
  return createResourceRef(connectionId, segments)
}

// What a source hands every builder below: its ref and its display name. A creation
// context's flat fields become a ref here; a live workspace or a saved record already
// carries one.
const fromOpened = (opened) => ({ target: openedRef(opened), connectionName: opened.connectionName })

function tableWorkspace({ target, connectionName }, state = createTableState(), ui = createTableUi()) {
  return {
    title: segmentName(target, 'table'),
    target,
    fields: {
      connectionName: connectionName ?? null,
      state, ui, runtime: createTableRuntime(target.connectionId),
    },
  }
}

// The SQL is the tab's state; its runs are runtime, so a duplicate starts without them.
function queryWorkspace({ target, connectionName }, sql = '') {
  const database = segmentName(target, 'database')
  return {
    title: 'SQL: ' + database,
    target,
    fields: {
      connectionName: connectionName ?? null,
      state: { sql },
      runtime: { run: createSqlRun(target.connectionId, database) },
    },
  }
}

// The typed search is the tab's state; its result is runtime, so a duplicate or a
// restored tab starts without one (#180).
function searchWorkspace({ target, connectionName }, state = createSearchState()) {
  return {
    title: 'Search: ' + segmentName(target, 'schema'),
    target,
    fields: {
      connectionName: connectionName ?? null,
      state, runtime: createSearchRuntime(),
    },
  }
}

export const postgresDefinitions = [
  {
    type: 'postgresql.table_browse',
    engine: 'postgresql',
    component: PostgresTableWorkspace,
    create: (ctx) => tableWorkspace(fromOpened(ctx.target), createTableState({ rowKey: ctx.options?.rowKey })),
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
    create: (ctx) => queryWorkspace(fromOpened(ctx.target)),
    duplicate: (workspace) => queryWorkspace(workspace, workspace.state.sql),
    serialize: (workspace) => ({ sql: workspace.state.sql }),
    restore: (saved) => queryWorkspace(saved, saved.sql ?? ''),
    dispose: (workspace) => rollBackOnClose(workspace.runtime.run),
  },
  {
    type: 'postgresql.search',
    engine: 'postgresql',
    component: PostgresSearchWorkspace,
    create: (ctx) => searchWorkspace(fromOpened(ctx.target)),
    duplicate: (workspace) => searchWorkspace(workspace, copy(workspace.state)),
    serialize: (workspace) => copy({ state: workspace.state }),
    restore: (saved) => searchWorkspace(saved, { ...createSearchState(), ...saved.state }),
    dispose: (workspace) => cancelSearch(workspace),
  },
]
