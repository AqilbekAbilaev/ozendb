<script setup>
import { errTitle } from '../../utils/errors'
import BaseIcon from '../base/BaseIcon.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import StatsTip from './StatsTip.vue'
import { useStatsTip } from '../../composables/useStatsTip'
import { colorHex } from '../../utils/tabColor.js'
import { connDatabases } from '../../stores/connectionData.js'
import { useConnectionTree } from '../../composables/useConnectionTree.js'

const props = defineProps({
  activeCollectionKey: String,
  expandId: String,
  width: { type: Number, default: 320 },
  tagOverrides: { type: Object, default: () => ({}) },
  contextActiveNodeKey: { type: String, default: null },
})
const emit = defineEmits(['select-collection', 'expanded', 'context-menu', 'select-node', 'connections-changed'])

const {
  connections, expandedConns, loadingConns, connErrors, expandedDbs, selectedKey,
  searchText, sidebarEl, filtered, setSelection, clearSelection, selectConnection,
  toggleConnection, toggleDatabase, highlightCollection, openSelectedCollection,
  openCollection, collectionKey, disconnectConn, refreshConn, getConnections,
} = useConnectionTree({ props, emit })

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
