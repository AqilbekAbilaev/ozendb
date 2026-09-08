import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { listConnections } from '../engines/mongodb/api/connections'
import { listen } from '@tauri-apps/api/event'
import { setConnectionOpen } from '../appApi/connectionState'
import { errCode, errMessage } from '../utils/errors'
import { applyConnectionUpdate } from '../utils/connectionList'
import { resourceFromTreeSelection } from '../utils/legacyResourceRef'
import {
  connectionResourceLoading, connectionResourceErrors,
  ensureConnectionResources, refreshConnectionResources, clearConnectionResources,
} from '../stores/connectionData'
import {
  connectionOpenRequest,
  consumeConnectionOpenRequest,
} from '../stores/connectionNavigation'

export function useConnectionTree({ props, emit }) {
  const connections = ref([])
  const expandedConns = ref({})      // connId → boolean
  const loadingConns = connectionResourceLoading
  const connErrors = computed(() => Object.fromEntries(
    Object.entries(connectionResourceErrors.value).map(([id, error]) => [
      id, { message: errMessage(error), code: errCode(error) },
    ]),
  ))
  const expandedDbs = ref({})        // "connId/dbName" → boolean
  const selectedKey = ref(null)      // collection row highlighted by a single click
  // The current single-click sidebar selection, at whatever level was clicked:
  //   { connectionId, connectionName, dbName, collectionName, kind, resource } | null
  // This is what the native menu gates on (a selected connection/database/
  // collection enables the matching items), so it's emitted to App.vue.
  const selection = ref(null)
  const searchText = ref('')

  // Records the selection at any tree level and tells App.vue, which folds it into
  // the menu context. Also drives the collection-row highlight (selectedKey).
  function setSelection(sel) {
    // Dual-carry: the canonical ResourceRef rides alongside the flat fields so
    // consumers can move onto it before those are dropped. Derived here, where the
    // clicked level is known for certain, instead of being re-inferred downstream
    // from which fields happen to be set.
    selection.value = sel && { ...sel, resource: resourceFromTreeSelection(sel) }
    selectedKey.value = sel && sel.kind === 'collection'
      ? collectionKey(sel.connectionId, sel.dbName, sel.collectionName)
      : null
    emit('select-node', selection.value)
  }

  function clearSelection() {
    if (selection.value) setSelection(null)
  }
  const sidebarEl = ref(null)        // root element, used to detect outside clicks

  // A single click anywhere outside the sidebar (e.g. in the QueryWorkspace) clears
  // the single-click collection highlight. Clicks inside the sidebar are handled by
  // the per-row handlers, so they're ignored here.
  function clearSelectionOnOutsideClick(e) {
    if (sidebarEl.value && !sidebarEl.value.contains(e.target)) {
      clearSelection()
    }
  }

  onMounted(async () => {
    // The sidebar shows only the connections that are open; the full saved list
    // lives in the Connection Manager. A connection's `open` flag is persisted, so
    // only the ones that were open before a restart come back.
    const all = await listConnections()
    connections.value = all.filter(c => c.open)
    await listen('connection-saved', (e) => {
      if (!connections.value.some(c => c.id === e.payload.id)) {
        connections.value.push(e.payload)
      }
    })
    await listen('connection-updated', (e) => {
      connections.value = applyConnectionUpdate(connections.value, e.payload)
    })
    await listen('connection-deleted', (e) => {
      disconnectConn(e.payload.id, { persist: false })
    })
    document.addEventListener('click', clearSelectionOnOutsideClick)
  })

  onUnmounted(() => {
    document.removeEventListener('click', clearSelectionOnOutsideClick)
  })

  // User click on a connection row: record the selection (so connection-scoped menu
  // items enable) and expand/collapse it. Kept separate from `toggleConnection` so
  // the programmatic auto-expand (below) doesn't move the selection.
  function selectConnection(conn) {
    setSelection({
      connectionId: conn.id,
      connectionName: conn.name,
      dbName: null,
      collectionName: null,
      kind: 'connection',
    })
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

  function toggleDatabase(conn, dbName) {
    // Selecting a database row enables database-scoped menu items.
    setSelection({
      connectionId: conn.id,
      connectionName: conn.name,
      dbName: dbName,
      collectionName: null,
      kind: 'database',
    })
    const key = `${conn.id}/${dbName}`
    expandedDbs.value[key] = !expandedDbs.value[key]
  }

  // Single click only selects (highlights) the row; double click opens it. This
  // mirrors Studio-3T and lets the same collection be opened in several tabs.
  function highlightCollection(conn, db, collName) {
    setSelection({
      connectionId: conn.id,
      connectionName: conn.name,
      dbName: db.name,
      collectionName: collName,
      kind: 'collection',
    })
  }

  // Opens whatever collection is currently highlighted (single-click) in the tree.
  // Used by the toolbar's "Collection" button and the Collection menu. Returns false
  // when nothing is highlighted so the caller can guide the user.
  function openSelectedCollection() {
    const sel = selection.value
    if (!sel || sel.kind !== 'collection') return false
    openCollectionFor(sel.connectionId, sel.connectionName, sel.dbName, sel.collectionName)
    return true
  }

  function openCollection(conn, db, collName) {
    openCollectionFor(conn.id, conn.name, db.name, collName)
  }

  function openCollectionFor(connectionId, connectionName, dbName, collectionName) {
    // Opening makes the row the active collection, so its highlight comes from
    // `activeCollectionKey`. Clear the single-click selection set by the click
    // that preceded this double-click, otherwise it lingers as a stale highlight
    // after the active tab moves to another collection.
    setSelection(null)
    emit('select-collection', {
      connectionId: connectionId,
      connectionName: connectionName,
      dbName: dbName,
      collectionName: collectionName,
    })
  }

  function collectionKey(connId, dbName, collName) {
    return `${connId}/${dbName}/${collName}`
  }

  async function openRequestedConnection(request) {
    if (!request) return
    const { connectionId } = request
    let conn = connections.value.find(c => c.id === connectionId)
    if (!conn) {
      // Opening a connection that isn't in the sidebar yet: fetch just its config,
      // mark it open (persisted), and add only it — don't reload the whole list.
      const all = await listConnections()
      conn = all.find(c => c.id === connectionId)
      if (conn) {
        await setConnectionOpen(connectionId, true)
        connections.value.push(conn)
      }
    }
    if (conn && !expandedConns.value[connectionId]) {
      toggleConnection(conn)
    }
  }

  watch(connectionOpenRequest, () => {
    const pending = consumeConnectionOpenRequest()
    if (pending) openRequestedConnection(pending)
  })

  // When a collection becomes the active one (e.g. switching tabs in the
  // workspace), expand the sidebar down to it so the highlighted row is visible.
  // Only the connId and dbName are needed; a collection name may contain slashes,
  // so split on the first two separators only.
  watch(() => props.activeCollectionKey, async (key) => {
    if (!key) return
    const slash1 = key.indexOf('/')
    const slash2 = key.indexOf('/', slash1 + 1)
    if (slash1 === -1 || slash2 === -1) return
    const connId = key.slice(0, slash1)
    const dbName = key.slice(slash1 + 1, slash2)

    const conn = connections.value.find(c => c.id === connId)
    if (!conn) return  // not a connection the sidebar currently shows

    if (!expandedConns.value[connId]) {
      await toggleConnection(conn)
    }
    expandedDbs.value[`${connId}/${dbName}`] = true
  })

  // Tell App.vue how many connections are open, so the View → Refresh menu item
  // (which refreshes every connection) can enable whenever at least one exists.
  watch(() => connections.value.length, (count) => emit('connections-changed', count), { immediate: true })

  const filtered = computed(() => {
    if (!searchText.value) return connections.value
    const q = searchText.value.toLowerCase()
    return connections.value.filter(c => c.name.toLowerCase().includes(q))
  })

  function disconnectConn(connId, { persist = true } = {}) {
    // Drop a stale selection pointing at the connection that's going away.
    if (selection.value && selection.value.connectionId === connId) {
      setSelection(null)
    }
    connections.value = connections.value.filter(c => c.id !== connId)
    delete expandedConns.value[connId]
    clearConnectionResources(connId)
    for (const key of Object.keys(expandedDbs.value)) {
      if (key.startsWith(connId + '/')) {
        delete expandedDbs.value[key]
      }
    }
    // Persist the closed state so it doesn't re-open after restart. Skipped when the
    // connection was deleted (the record is already gone from storage).
    if (persist) {
      setConnectionOpen(connId, false)
    }
  }

  function getConnections() {
    return connections.value
  }
  return {
    connections,
    expandedConns,
    loadingConns,
    connErrors,
    expandedDbs,
    selectedKey,
    searchText,
    sidebarEl,
    filtered,
    setSelection,
    clearSelection,
    selectConnection,
    toggleConnection,
    retryConnection,
    toggleDatabase,
    highlightCollection,
    openSelectedCollection,
    openCollection,
    collectionKey,
    disconnectConn,
    getConnections,
  }
}
