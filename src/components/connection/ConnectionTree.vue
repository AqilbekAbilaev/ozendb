<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { errMessage, errCode, errTitle } from '../../utils/errors'
import { listen } from '@tauri-apps/api/event'
import BaseIcon from '../base/BaseIcon.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import StatsTip from './StatsTip.vue'
import { useStatsTip } from '../../composables/useStatsTip'
import { colorHex } from '../../utils/tabColor.js'
import { applyConnectionUpdate } from '../../utils/connectionList.js'
import { connDatabases } from '../../stores/connectionData.js'

const props = defineProps({
  activeCollectionKey: String,
  expandId: String,
  width: { type: Number, default: 320 },
  tagOverrides: { type: Object, default: () => ({}) },
  contextActiveNodeKey: { type: String, default: null },
})
const emit = defineEmits(['select-collection', 'expanded', 'context-menu', 'select-node', 'connections-changed'])

const connections = ref([])
const expandedConns = ref({})      // connId → boolean
const loadingConns = ref({})       // connId → boolean
const connErrors = ref({})         // connId → { message, code } (or null)
const expandedDbs = ref({})        // "connId/dbName" → boolean
const selectedKey = ref(null)      // collection row highlighted by a single click
// The current single-click sidebar selection, at whatever level was clicked:
//   { connectionId, connectionName, dbName, collectionName, kind } | null
// This is what the native menu gates on (a selected connection/database/
// collection enables the matching items), so it's emitted to App.vue.
const selection = ref(null)
const searchText = ref('')

// Records the selection at any tree level and tells App.vue, which folds it into
// the menu context. Also drives the collection-row highlight (selectedKey).
function setSelection(sel) {
  selection.value = sel
  selectedKey.value = sel && sel.kind === 'collection'
    ? collectionKey(sel.connectionId, sel.dbName, sel.collectionName)
    : null
  emit('select-node', sel)
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
  const all = await invoke('list_connections')
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

  if (!wasOpen && !connDatabases.value[id]) {
    loadingConns.value[id] = true
    connErrors.value[id] = null
    try {
      connDatabases.value[id] = await invoke('list_databases', { id: id })
    } catch (e) {
      connErrors.value[id] = { message: errMessage(e), code: errCode(e) }
      expandedConns.value[id] = false
    } finally {
      loadingConns.value[id] = false
    }
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

watch(() => props.expandId, async (id) => {
  if (!id) return
  let conn = connections.value.find(c => c.id === id)
  if (!conn) {
    // Opening a connection that isn't in the sidebar yet: fetch just its config,
    // mark it open (persisted), and add only it — don't reload the whole list.
    const all = await invoke('list_connections')
    conn = all.find(c => c.id === id)
    if (conn) {
      await invoke('set_connection_open', { id: id, open: true })
      connections.value.push(conn)
    }
  }
  if (conn && !expandedConns.value[id]) {
    toggleConnection(conn)
  }
  emit('expanded')
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

import { computed } from 'vue'
const filtered = computed(() => {
  if (!searchText.value) return connections.value
  const q = searchText.value.toLowerCase()
  return connections.value.filter(c => c.name.toLowerCase().includes(q))
})

// The colour name explicitly set on a node — its override (keyed by the node's
// full path) wins, otherwise the persisted fallback tag (connections only).
// Returns null when the node has no colour of its own (untagged or 'none').
function nodeTag(key, fallbackTag) {
  const override = props.tagOverrides[key]
  const name = override !== undefined ? override : (fallbackTag || null)
  return name && name !== 'none' ? name : null
}

// Effective colours cascade down the tree: a node shows its own colour if it has
// one, otherwise it inherits the nearest coloured ancestor's. Colouring a parent
// also resets its descendants (see App.vue) so they take the parent's colour even
// if they had their own — after which any of them can be re-coloured, and that
// own colour wins here again.
function connColor(conn) {
  return nodeTag(conn.id, conn.tag)
}
function dbColor(conn, dbName) {
  return nodeTag(`${conn.id}/${dbName}`, null) || connColor(conn)
}
function collColor(conn, dbName, collName) {
  return nodeTag(collectionKey(conn.id, dbName, collName), null) || dbColor(conn, dbName)
}

// A connection's live state, derived from what the tree already tracks:
//   error     → the last list_databases failed
//   loading   → databases are being fetched
//   connected → databases loaded successfully (we've talked to the server)
//   idle      → in the sidebar but not opened yet
function connStatus(conn) {
  const id = conn.id
  if (connErrors.value[id]) return 'error'
  if (loadingConns.value[id]) return 'loading'
  if (connDatabases.value[id]) return 'connected'
  return 'idle'
}

const STATUS_LABEL = {
  error:     'Connection error',
  loading:   'Connecting…',
  connected: 'Connected',
  idle:      'Not connected',
}

function onNodeContext(e, type, label, nodeData) {
  // The stats card opens at the pointer, which is exactly where the menu is about to
  // appear — drop it at once rather than leaving it to the hover grace period.
  statsTip.hide()
  emit('context-menu', { type: type, x: e.clientX, y: e.clientY, label: label, nodeData: nodeData })
}

function disconnectConn(connId, { persist = true } = {}) {
  // Drop a stale selection pointing at the connection that's going away.
  if (selection.value && selection.value.connectionId === connId) {
    setSelection(null)
  }
  connections.value = connections.value.filter(c => c.id !== connId)
  delete expandedConns.value[connId]
  delete loadingConns.value[connId]
  delete connDatabases.value[connId]
  delete connErrors.value[connId]
  for (const key of Object.keys(expandedDbs.value)) {
    if (key.startsWith(connId + '/')) {
      delete expandedDbs.value[key]
    }
  }
  // Persist the closed state so it doesn't re-open after restart. Skipped when the
  // connection was deleted (the record is already gone from storage).
  if (persist) {
    invoke('set_connection_open', { id: connId, open: false })
  }
}

async function refreshConn(connId) {
  if (!expandedConns.value[connId]) return
  delete connDatabases.value[connId]
  loadingConns.value[connId] = true
  connErrors.value[connId] = null
  try {
    connDatabases.value[connId] = await invoke('list_databases', { id: connId })
  } catch (e) {
    connErrors.value[connId] = { message: errMessage(e), code: errCode(e) }
    expandedConns.value[connId] = false
  } finally {
    loadingConns.value[connId] = false
  }
}

function getConnections() {
  return connections.value
}

// Hovering a database or collection row pops its stats card (see useStatsTip). The rows
// pass their own target, so the card needs no per-kind handler here.
const { tip, ...statsTip } = useStatsTip()

defineExpose({ disconnectConn, refreshConn, getConnections, openSelectedCollection })
</script>

<template>
  <div class="sidebar" ref="sidebarEl" :style="{ width: props.width + 'px' }">
    <!-- Search row -->
    <div class="side-search">
      <div class="search-box">
        <BaseIcon name="search" :size="14" style="color:var(--text-faint);flex:none" />
        <BaseInput v-model="searchText" class="tree-search" placeholder="Search open connections (⌘F)" />
      </div>
      <BaseButton icon="textType" size="sm" :icon-size="15" title="Font size" />
    </div>

    <!-- Tree -->
    <!-- Clicking empty space in the tree clears a single-click collection highlight. -->
    <!-- Scrolling leaves the stats card anchored to a row that has moved, so drop it. -->
    <div class="tree" @click.self="clearSelection" @scroll.passive="statsTip.hide">
      <div v-if="filtered.length === 0" class="tree-empty">
        No connections. Use File → Connect.
      </div>

      <template v-for="conn in filtered" :key="conn.id">
        <!-- Connection root -->
        <div
          class="tnode"
          :class="{
            sel: activeCollectionKey?.startsWith(conn.id),
            'ctx-sel': props.contextActiveNodeKey === conn.id,
            tagged: !!connColor(conn),
          }"
          :style="connColor(conn) ? { '--tag-color': colorHex(connColor(conn)) } : null"
          style="padding-left: 6px"
          @click="selectConnection(conn)"
          @contextmenu.prevent="onNodeContext($event, 'connection', conn.name, { connId: conn.id, connName: conn.name })"
        >
          <span class="tw">
            <BaseIcon :name="expandedConns[conn.id] ? 'caretDown' : 'caret'" :size="12" />
          </span>
          <span class="ti"><BaseIcon name="connect" :size="15" /></span>
          <span class="tt">{{ conn.name }}</span>
          <span
            v-if="conn.read_only"
            class="ro-lock"
            title="Read-only connection — writes are disabled"
          ><BaseIcon name="lock" :size="12" /></span>
          <span
            class="status-dot"
            :class="connStatus(conn)"
            :title="STATUS_LABEL[connStatus(conn)]"
          ></span>
        </div>

        <!-- Loading indicator -->
        <div v-if="loadingConns[conn.id]" class="tnode" style="padding-left: 36px">
          <span class="mini-spin"></span>
          <span class="tt" style="color:var(--text-faint);font-size:11.5px">Loading…</span>
        </div>

        <!-- Error -->
        <div v-if="connErrors[conn.id]" class="tnode err-node" style="padding-left: 36px">
          <span class="err-msg">{{ errTitle(connErrors[conn.id].code) || connErrors[conn.id].message }}</span>
          <details v-if="errTitle(connErrors[conn.id].code) && connErrors[conn.id].message" class="err-details">
            <summary>Details</summary>
            <div class="err-details-body">{{ connErrors[conn.id].message }}</div>
          </details>
          <span class="err-retry" @click.stop="toggleConnection(conn)">Retry</span>
        </div>

        <!-- Databases -->
        <template v-if="expandedConns[conn.id] && connDatabases[conn.id]">
          <template v-for="db in connDatabases[conn.id]" :key="db.name">
            <!-- Database row -->
            <div
              class="tnode"
              :class="{
                tagged: !!dbColor(conn, db.name),
                locked: !db.accessible,
                'ctx-sel': props.contextActiveNodeKey === conn.id + '/' + db.name,
              }"
              :style="dbColor(conn, db.name) ? { '--tag-color': colorHex(dbColor(conn, db.name)) } : null"
              style="padding-left: 21px"
              @click="db.accessible ? toggleDatabase(conn, db.name) : setSelection(null)"
              @contextmenu.prevent="onNodeContext($event, 'database', db.name, { connId: conn.id, dbName: db.name })"
              @mouseenter="db.accessible && statsTip.show($event, { connId: conn.id, dbName: db.name })"
              @mousemove="statsTip.move"
              @mouseleave="statsTip.hideSoon"
            >
              <span class="tw">
                <BaseIcon v-if="!db.accessible" name="lock" :size="12" />
                <BaseIcon v-else :name="expandedDbs[`${conn.id}/${db.name}`] ? 'caretDown' : 'caret'" :size="12" />
              </span>
              <span class="ti"><BaseIcon name="dbSmall" :size="15" /></span>
              <span class="tt">{{ db.name }}</span>
              <span v-if="db.accessible && db.collections.length" class="cnt">({{ db.collections.length }})</span>
            </div>

            <!-- Collections -->
            <template v-if="expandedDbs[`${conn.id}/${db.name}`]">
              <div
                v-for="coll in db.collections"
                :key="coll"
                class="tnode"
                :class="{
                  sel: activeCollectionKey === collectionKey(conn.id, db.name, coll)
                    || selectedKey === collectionKey(conn.id, db.name, coll),
                  'ctx-sel': props.contextActiveNodeKey === collectionKey(conn.id, db.name, coll),
                  tagged: !!collColor(conn, db.name, coll),
                }"
                :style="collColor(conn, db.name, coll) ? { '--tag-color': colorHex(collColor(conn, db.name, coll)) } : null"
                style="padding-left: 51px"
                @click="highlightCollection(conn, db, coll)"
                @dblclick="openCollection(conn, db, coll)"
                @mouseenter="statsTip.show($event, { connId: conn.id, dbName: db.name, collName: coll })"
                @mousemove="statsTip.move"
                @mouseleave="statsTip.hideSoon"
                @contextmenu.prevent="onNodeContext($event, 'collection', coll, { connId: conn.id, connName: conn.name, dbName: db.name, collName: coll })"
              >
                <span class="tw empty"><BaseIcon name="caret" :size="12" /></span>
                <span class="ti"><BaseIcon name="collSmall" :size="15" /></span>
                <span class="tt">{{ coll }}</span>
              </div>
            </template>
          </template>
        </template>
      </template>
    </div>

    <StatsTip :tip="tip" @keep="statsTip.keep" @leave="statsTip.hideSoon" @refresh="statsTip.refresh" />
  </div>
</template>

<style scoped>
.sidebar {
  flex: none;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.side-search {
  padding: 8px;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--bg-input);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 6px 9px;
}

.base-input.tree-search {
  flex: 1;
  background: none;
  border: none;
  padding: 0;
  font-size: 12.5px;
}


.tree {
  flex: 1;
  overflow-y: auto;
  padding: 2px 0 12px;
}

.tree-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--text-faint);
  text-align: center;
}

.tnode {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 0;
  font-size: 12.5px;
  cursor: default;
  white-space: nowrap;
  user-select: none;
}

.tnode:hover  { background: var(--bg-hover); }
.tnode.sel    { background: var(--bg-active); }
.tnode.ctx-sel { background: var(--bg-hover); }

.tw {
  width: 16px;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  flex: none;
}
.tw.empty { visibility: hidden; }

.ti { flex: none; color: var(--text-dim); }
.tt { overflow: hidden; text-overflow: ellipsis; }

/* Faint padlock next to a read-only connection's name. */
.ro-lock { flex: none; display: inline-flex; align-items: center; color: var(--text-faint); margin-left: 5px; }

.cnt { color: var(--text-faint); font-size: 11.5px; margin-left: 4px; }

/* Per-connection status dot, pushed to the right edge of the row. */
.status-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-left: auto;
  margin-right: 8px;
  background: var(--text-faint);
}
.status-dot.connected { background: var(--green); }
.status-dot.error     { background: var(--prod); }
.status-dot.idle      { background: var(--text-faint); opacity: .45; }
.status-dot.loading {
  background: var(--warn);
  animation: status-pulse 1s ease-in-out infinite;
}
@keyframes status-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }

.err-node { align-items: flex-start; cursor: default; flex-direction: column; gap: 2px; }
.err-msg { color: var(--danger-text); font-size: 11.5px; white-space: pre-wrap; word-break: break-word; line-height: 1.5; padding: 2px 0; }
.err-retry { color: var(--accent); font-size: 11.5px; cursor: pointer; }
.err-retry:hover { text-decoration: underline; }
.err-details { font-size: 11px; align-self: stretch; }
.err-details summary { color: var(--text-faint); cursor: pointer; user-select: none; }
.err-details summary:hover { color: var(--text-dim); }
.err-details-body {
  margin-top: 4px;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--bg-toolbar);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-family: var(--font-mono, monospace);
  font-size: 10.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.mini-spin {
  width: 11px;
  height: 11px;
  margin-right: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  border-top-color: var(--accent);
  animation: tree-spin 0.7s linear infinite;
  flex: none;
}
@keyframes tree-spin { to { transform: rotate(360deg); } }

.tnode.tagged .tt,
.tnode.tagged .ti { color: var(--tag-color); }

.tnode.locked { cursor: default; }
.tnode.locked .tt,
.tnode.locked .ti,
.tnode.locked .tw { color: var(--text-faint); }
</style>
