// Right-click menus and actions an engine handles itself, keyed by engine. MongoDB's are still the
// FEATURES table in composables/useFeatures.js, which takes any action not found here.
import { PG_ACTIONS, PG_MENUS } from './postgresql/tree/contextMenus.js'
import { MYSQL_ACTIONS, MYSQL_MENUS } from './mysql/tree/contextMenus.js'
import { createResourceRef } from '../utils/resourceRef.js'

const CONTEXT_ACTIONS = Object.freeze({ postgresql: PG_ACTIONS, mysql: MYSQL_ACTIONS })

/** The engine's own handler for `action` on this node, or null. */
export function contextAction(nodeData, action) {
  return CONTEXT_ACTIONS[nodeData?.engine]?.[action] ?? null
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
