// PostgreSQL workspace definitions: the shared table tab (tableDefinition.js), and a
// query and a search tab whose typed text is their `state` and whose results are
// `runtime`. A session saves the state; runtime starts fresh.
import { defineAsyncComponent } from 'vue'
import PostgresSearchWorkspace from './PostgresSearchWorkspace.vue'
import { createResourceRef, segmentName } from '../../../utils/resourceRef'
import { rollBackOnClose, tableDefinition } from '../../sql/workspaces/tableDefinition.js'
import { createSqlRun } from '../../sql/workspaces/runSql.js'
import { createSearchState, createSearchRuntime, cancelSearch } from './searchRun.js'

// It carries the SQL editor (CodeMirror), so it loads when the first tab opens rather
// than at launch. Module scope keeps it a single component identity.
const SqlQueryWorkspace = defineAsyncComponent(() => import('../../sql/workspaces/SqlQueryWorkspace.vue'))

const ENGINE = 'postgresql'

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

// The SQL is the tab's state; its runs are runtime, so a duplicate starts without them.
function queryWorkspace({ target, connectionName }, sql = '') {
  const database = segmentName(target, 'database')
  return {
    title: 'SQL: ' + database,
    target,
    fields: {
      connectionName: connectionName ?? null,
      state: { sql },
      runtime: { run: createSqlRun(ENGINE, target.connectionId, database) },
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
  tableDefinition(ENGINE, openedRef),
  {
    type: 'postgresql.query',
    engine: ENGINE,
    component: SqlQueryWorkspace,
    create: (ctx) => queryWorkspace(fromOpened(ctx.target)),
    duplicate: (workspace) => queryWorkspace(workspace, workspace.state.sql),
    serialize: (workspace) => ({ sql: workspace.state.sql }),
    restore: (saved) => queryWorkspace(saved, saved.sql ?? ''),
    dispose: (workspace) => rollBackOnClose(workspace.runtime.run),
  },
  {
    type: 'postgresql.search',
    engine: ENGINE,
    component: PostgresSearchWorkspace,
    create: (ctx) => searchWorkspace(fromOpened(ctx.target)),
    duplicate: (workspace) => searchWorkspace(workspace, copy(workspace.state)),
    serialize: (workspace) => copy({ state: workspace.state }),
    restore: (saved) => searchWorkspace(saved, { ...createSearchState(), ...saved.state }),
    dispose: (workspace) => cancelSearch(workspace),
  },
]
