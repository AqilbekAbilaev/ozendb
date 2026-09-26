import { ref } from 'vue'
import { listConnections } from '../appApi/connections'
import { setConnectionOpen } from '../appApi/connectionState'
import { clearConnectionResources } from './connectionData'
import { applyConnectionUpdate } from '../utils/connectionList'

// The connections currently open — what the sidebar lists, and the registry anything
// else asks "which connections are open?" of.
//
// Module-scope rather than owned by the tree because it is not tree state: the action
// dispatcher needs it to disconnect one/others/all, and reaching into a mounted child
// component for that made app logic depend on the sidebar being rendered.
//
// The sibling store connectionData.js holds the databases fetched *within* each of
// these connections; closing one here releases them.
export const openConnections = ref([])

// Load-once latch. The tree mounts and unmounts (it is a v-if'd pane), so without
// this every remount refetches a list that has not changed.
let loaded = null

/** Fetch the open connections once. Repeat callers share the in-flight promise. */
export function loadOpenConnections() {
  if (loaded) return loaded
  loaded = listConnections()
    .then((all) => {
      // A connection's `open` flag is persisted, so only the ones open before a
      // restart come back. The full saved list lives in the Connection Manager.
      openConnections.value = (all || []).filter(c => c.open)
    })
    // Swallowed deliberately: a failed load leaves the sidebar empty, which is what
    // the user sees anyway, and every caller is a mount hook with nowhere to report.
    .catch(() => {})
  return loaded
}

export function addOpenConnection(conn) {
  if (openConnections.value.some(c => c.id === conn.id)) return
  openConnections.value = [...openConnections.value, conn]
}

/** Replace a listed connection wholesale. An unlisted one is ignored — editing a
 *  closed connection must not make it appear in the sidebar. */
export function updateOpenConnection(conn) {
  openConnections.value = applyConnectionUpdate(openConnections.value, conn)
}

/**
 * Close a connection: drop it from the list, release its cached databases, and
 * persist the closed state. Pass `persist: false` when the connection was *deleted* —
 * its record is already gone, so writing to it would fail or resurrect it.
 *
 * Never rejects. Closing is a UI action with no error surface, and the list must end
 * up without the connection either way.
 */
export function closeConnection(id, { persist = true } = {}) {
  openConnections.value = openConnections.value.filter(c => c.id !== id)
  clearConnectionResources(id)
  if (!persist) return Promise.resolve()
  return Promise.resolve(setConnectionOpen(id, false)).catch(() => {})
}

/**
 * Open a saved connection by id — the "open it from somewhere other than the sidebar"
 * path. Already listed, it is returned as-is. Otherwise its config is fetched and only
 * that one is added: reloading the whole list would stamp over the user's current view.
 * Null when the id no longer names a saved connection.
 */
export async function openConnectionById(id) {
  const listed = openConnections.value.find(c => c.id === id)
  if (listed) return listed
  const all = await listConnections()
  const conn = (all || []).find(c => c.id === id)
  if (!conn) return null
  await setConnectionOpen(id, true)
  addOpenConnection(conn)
  return conn
}

/** Test seam, and the reset used if the whole list must be refetched. */
export function resetOpenConnections() {
  loaded = null
  openConnections.value = []
}
