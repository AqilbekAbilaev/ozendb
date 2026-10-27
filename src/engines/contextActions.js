// Right-click menus, actions and toolbar tools an engine handles itself, keyed by engine.
import { PG_ACTIONS, PG_MENUS } from './postgresql/tree/contextMenus.js'
import { MYSQL_ACTIONS, MYSQL_MENUS } from './mysql/tree/contextMenus.js'
import { useMongoActions } from './mongodb/tree/actions.js'
import { runPgTool } from './postgresql/toolbarActions.js'
import { runMongoTool } from './mongodb/toolbarActions.js'
import { createResourceRef } from '../utils/resourceRef.js'

const CONTEXT_ACTIONS = Object.freeze({ postgresql: PG_ACTIONS, mysql: MYSQL_ACTIONS })

/** The engine's own handler for `action` on this node, or null. */
export function contextAction(nodeData, action) {
  return CONTEXT_ACTIONS[nodeData?.engine]?.[action] ?? null
}

// Actions the shared dispatcher (composables/useFeatures) runs by id alone, each
// `{ requires, run(ref, ctx) }`, so the native menu and the toolbar reach them as well as
// the right-click menu. Only MongoDB's take this shape.
const LEVELLED_ACTIONS = Object.freeze({ mongodb: useMongoActions })

/** Every engine's id-dispatched actions, merged into one table keyed by action id. */
export function useEngineActions() {
  return Object.assign({}, ...Object.values(LEVELLED_ACTIONS).map((make) => make()))
}

// Each engine's toolbar and native-menu tools. A runner returns false for a tool that
// isn't its own. `target` is the native menu's resolved MongoDB node (null from the
// toolbar), `pgMenuTarget` PostgreSQL's resolver, `runFeature` the shared dispatcher.
const TOOLBARS = Object.freeze({
  postgresql: (name, { pgMenuTarget }) => runPgTool(name, pgMenuTarget),
  mongodb: (name, { target, runFeature }) => runMongoTool(name, target, runFeature),
})

/** Runs the engine tool called `name`; false when no engine has one. */
export function runEngineTool(name, context) {
  return Object.values(TOOLBARS).some((run) => run(name, context))
}

// A connection whose engine has a menu of its own: the node its actions get, and the
// items. MongoDB has none here; it uses the shared `connection` menu. The node carries a
// `resource` beside the engine's own fields, for the shared actions (Refresh, Disconnect…).
const CONNECTION_MENUS = Object.freeze({
  postgresql: (conn) => ({
    node: {
      connId: conn.id, connName: conn.name, engine: 'postgresql', database: conn.database || 'postgres',
      resource: createResourceRef(conn.id),
    },
    items: PG_MENUS.connection,
  }),
  mysql: (conn) => ({
    node: {
      connId: conn.id, connName: conn.name, engine: 'mysql', database: conn.database || null,
      resource: createResourceRef(conn.id),
    },
    items: MYSQL_MENUS.connection,
  }),
})

/** The engine's own right-click menu for a connection, or null for the shared one. */
export function connectionMenu(conn) {
  return CONNECTION_MENUS[conn.engine]?.(conn) ?? null
}
