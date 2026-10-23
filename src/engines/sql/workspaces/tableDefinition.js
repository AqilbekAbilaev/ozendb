// The table tab's workspace definition, which every SQL engine registers as its own
// `<engine>.table_browse`. A tab is plain data: what the user built as `state`, its panel
// as `ui`, and what it loaded or is running as `runtime` (tableState.js). A session saves
// the state; runtime starts fresh and loads again.
import { defineAsyncComponent } from 'vue'
import { segmentName } from '../../../utils/resourceRef'
import { createTableState, createTableUi, createTableRuntime, migrateTableState } from './tableState.js'
import { abandonTransaction } from './runSql.js'
import { showToast } from '../../../stores/toast'

// It carries the SQL editor (CodeMirror), so it loads when the first tab opens rather
// than at launch. Module scope keeps it a single component identity.
const SqlTableWorkspace = defineAsyncComponent(() => import('./SqlTableWorkspace.vue'))

// Tabs are reactive, which structuredClone can't copy; state and ui are JSON-only.
const copy = (value) => JSON.parse(JSON.stringify(value))

// A closing tab can't ask first (closes are synchronous), so the safe side wins:
// its open transaction is rolled back, and a message says so.
export async function rollBackOnClose(run) {
  if (await abandonTransaction(run)) showToast('The closed tab had a transaction open; it was rolled back.')
}

// `refOf` turns what the engine's openers pass into the tab's ref. A tab's identity is
// that `target` alone (#303): beside it the tab keeps only the connection's display name.
export function tableDefinition(engine, refOf) {
  function tableWorkspace({ target, connectionName }, state = createTableState(), ui = createTableUi()) {
    return {
      title: segmentName(target, 'table'),
      target,
      fields: {
        connectionName: connectionName ?? null,
        state, ui, runtime: createTableRuntime(engine, target.connectionId),
      },
    }
  }

  return {
    type: `${engine}.table_browse`,
    engine,
    component: SqlTableWorkspace,
    create: (ctx) => tableWorkspace(
      { target: refOf(ctx.target), connectionName: ctx.target.connectionName },
      createTableState({ rowKey: ctx.options?.rowKey }),
    ),
    // Filter mode only reads; SQL mode runs whatever SQL the user wrote.
    canRefresh: (workspace) => workspace.state.mode === 'filter',
    // A copy keeps the query and the panel; rows load again.
    duplicate: (workspace) => tableWorkspace(workspace, copy(workspace.state), copy(workspace.ui)),
    serialize: (workspace) => copy({ state: workspace.state, ui: workspace.ui }),
    restore: (saved) => tableWorkspace(saved, migrateTableState(saved), { ...createTableUi(), ...saved.ui }),
    dispose: (workspace) => rollBackOnClose(workspace.runtime.sqlRun),
  }
}
