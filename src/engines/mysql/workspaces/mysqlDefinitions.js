// MySQL workspace definitions: the shared table tab, opened on a `database/table` ref, and
// a query tab whose typed SQL is its `state` and whose runs are `runtime`. A session saves
// the state; runtime starts fresh. They are built per engine, so MariaDB registers the same
// pair under its own id while a saved MySQL session restores unchanged.
import { defineAsyncComponent } from 'vue'
import { createResourceRef, segmentName } from '../../../utils/resourceRef'
import { rollBackOnClose, tableDefinition } from '../../sql/workspaces/tableDefinition.js'
import { createSqlRun } from '../../sql/workspaces/runSql.js'

// It carries the SQL editor (CodeMirror), so it loads when the first tab opens rather
// than at launch. Module scope keeps it a single component identity.
const SqlQueryWorkspace = defineAsyncComponent(() => import('../../sql/workspaces/SqlQueryWorkspace.vue'))

// The SQL is the tab's state; its runs are runtime, so a duplicate starts without them.
// It opens in the database of the row it was opened on, or, from the connection, in the
// one its sessions start in by default.
function queryWorkspace(engine, { target, connectionName }, sql = '') {
  const database = segmentName(target, 'database')
  return {
    title: 'SQL: ' + (database ?? connectionName),
    target: createResourceRef(target.connectionId, database == null ? [] : [{ kind: 'database', name: database }]),
    fields: {
      connectionName: connectionName ?? null,
      state: { sql },
      runtime: { run: createSqlRun(engine, target.connectionId, database) },
    },
  }
}

export const mysqlDefinitions = (engine) => [
  tableDefinition(engine, (opened) => opened.resource),
  {
    type: `${engine}.query`,
    engine,
    component: SqlQueryWorkspace,
    create: (ctx) => queryWorkspace(engine, { target: ctx.target.resource, connectionName: ctx.target.connectionName }),
    duplicate: (workspace) => queryWorkspace(engine, workspace, workspace.state.sql),
    serialize: (workspace) => ({ sql: workspace.state.sql }),
    restore: (saved) => queryWorkspace(engine, saved, saved.sql ?? ''),
    dispose: (workspace) => rollBackOnClose(workspace.runtime.run),
  },
]
