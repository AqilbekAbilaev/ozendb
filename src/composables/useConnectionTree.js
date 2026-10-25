import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { onConnectionSaved, onConnectionUpdated, onConnectionDeleted } from '../appApi/events'
import { errCode, errMessage } from '../utils/errors'
import { createResourceRef } from '../utils/resourceRef'
import { activeTab, activeTabId } from '../stores/tabs'
import {
  connectionResourceLoading, connectionResourceErrors,
  ensureConnectionResources, refreshConnectionResources,
} from '../stores/connectionData'
import {
  openConnections, loadOpenConnections, addOpenConnection,
  updateOpenConnection, closeConnection, openConnectionById,
} from '../stores/openConnections'
import {
  connectionOpenRequest,
  consumeConnectionOpenRequest,
  treeSelection, setTreeSelection,
} from '../stores/connectionNavigation'
import { isCollectionTab } from '../utils/workspaceTypes'
import { workspaceBrowsesTable } from '../workspaces/registry'

export function useConnectionTree() {
  // The open-connection registry lives in the store; the tree renders it and owns
  // only its own view state (expansion, selection, search).
  const connections = openConnections
  const expandedConns = ref({})      // connId → boolean
  const loadingConns = connectionResourceLoading
  const connErrors = computed(() => Object.fromEntries(
    Object.entries(connectionResourceErrors.value).map(([id, error]) => [
      id, { message: errMessage(error), code: errCode(error) },
    ]),
  ))
  const searchText = ref('')

  const setSelection = setTreeSelection

  function clearSelection() {
    if (treeSelection.value) setSelection(null)
  }
  const sidebarEl = ref(null)        // root element, used to detect outside clicks

  // A single click anywhere outside the sidebar (e.g. in a workspace) clears
  // the single-click collection highlight. Clicks inside the sidebar are handled by
  // the per-row handlers, so they're ignored here.
  function clearSelectionOnOutsideClick(e) {
    if (sidebarEl.value && !sidebarEl.value.contains(e.target)) {
      clearSelection()
    }
  }

  // The store is the source of truth for which connections are open, so the tree
  // prunes its own view state when one leaves — whoever closed it. Doing this in each
  // caller instead meant the action dispatcher had to reach into the sidebar component
  // just to keep its expansion state honest.
  watch(openConnections, (list) => {
    const live = new Set(list.map(c => c.id))
    if (treeSelection.value && !live.has(treeSelection.value.resource.connectionId)) setSelection(null)
    for (const id of Object.keys(expandedConns.value)) {
      if (!live.has(id)) delete expandedConns.value[id]
    }
    // Synchronous on purpose: an async flush leaves a tick where the selection still
    // names a connection that is gone, and the native menu derives its enabled items
    // from that selection. The body only prunes local refs, so it is cheap and safe
    // to run inline.
  }, { flush: 'sync' })

  let unlisten = []

  onMounted(async () => {
    // The sidebar shows only the connections that are open; the full saved list
    // lives in the Connection Manager. A connection's `open` flag is persisted, so
    // only the ones that were open before a restart come back.
    await loadOpenConnections()
    unlisten = [
      onConnectionSaved(addOpenConnection),
      onConnectionUpdated(updateOpenConnection),
      onConnectionDeleted(({ id }) => {
        disconnectConn(id, { persist: false })
      }),
    ]
    document.addEventListener('click', clearSelectionOnOutsideClick)
  })

  onUnmounted(() => {
    unlisten.forEach(p => p.then(off => off()))
    document.removeEventListener('click', clearSelectionOnOutsideClick)
  })

  // User click on a connection row: record the selection (so connection-scoped menu
  // items enable) and expand/collapse it. Kept separate from `toggleConnection` so
  // the programmatic auto-expand (below) doesn't move the selection.
  function selectConnection(conn) {
    setSelection({ resource: createResourceRef(conn.id), connectionName: conn.name, engine: conn.engine })
    toggleConnection(conn)
  }

  async function toggleConnection(conn) {
    const id = conn.id
    const wasOpen = expandedConns.value[id]
    expandedConns.value[id] = !wasOpen

    if (!wasOpen) {
      try {
        await ensureConnectionResources(id)
      } catch {
        if (connectionResourceErrors.value[id]) expandedConns.value[id] = false
      }
    }
  }

  async function retryConnection(conn) {
    expandedConns.value[conn.id] = true
    try {
      await refreshConnectionResources(conn.id)
    } catch {
      if (connectionResourceErrors.value[conn.id]) expandedConns.value[conn.id] = false
    }
  }

  async function openRequestedConnection(request) {
    if (!request) return
    const { connectionId } = request
    const conn = await openConnectionById(connectionId)
    if (conn && !expandedConns.value[connectionId]) {
      toggleConnection(conn)
    }
  }

  watch(connectionOpenRequest, () => {
    const pending = consumeConnectionOpenRequest()
    if (pending) openRequestedConnection(pending)
  })

  // The resource the active tab browses, whichever engine: a MongoDB collection or a
  // SQL table. Its row is the one the tree highlights.
  const activeResource = computed(() => {
    const t = activeTab.value
    return isCollectionTab(t) || workspaceBrowsesTable(t) ? t : null
  })
  // The connection whose row highlights. Was a startsWith() over the collection key,
  // which prefix-matched an id instead of comparing one, and only ever for MongoDB.
  const activeConnectionId = computed(() => activeResource.value?.target?.connectionId ?? null)

  // Keyboard tab switches never click outside the sidebar, so clear the selection here.
  watch(activeTabId, clearSelection)

  // When it becomes the active one (switching tabs, or a restored session) expand the
  // sidebar down to it, so the highlighted row is on screen rather than hidden under a
  // collapsed parent. Only the connection level is shared: each engine's own tree holds
  // the state below it and opens itself (useMongoTree, PostgresTreeNodes).
  watch(activeResource, async (t) => {
    if (!t) return
    const conn = connections.value.find(c => c.id === t.target.connectionId)
    if (!conn) return  // not a connection the sidebar currently shows

    if (!expandedConns.value[conn.id]) {
      await toggleConnection(conn)
    }
  })

  const filtered = computed(() => {
    if (!searchText.value) return connections.value
    const q = searchText.value.toLowerCase()
    return connections.value.filter(c => c.name.toLowerCase().includes(q))
  })

  function disconnectConn(connId, { persist = true } = {}) {
    // Purely a delegation now. The view cleanup that used to live here runs off the
    // watcher below, so it happens however a connection leaves the list.
    closeConnection(connId, { persist: persist })
  }

  return {
    connections,
    expandedConns,
    loadingConns,
    connErrors,
    searchText,
    sidebarEl,
    filtered,
    setSelection,
    clearSelection,
    selectConnection,
    toggleConnection,
    retryConnection,
    activeConnectionId,
    disconnectConn,
  }
}
