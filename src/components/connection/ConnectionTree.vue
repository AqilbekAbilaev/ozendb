<script setup>
import { errTitle } from '../../utils/errors'
import { contextMenu, contextActiveNodeKey } from '../../stores/contextMenu'
import BaseIcon from '../base/BaseIcon.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import StatsTip from './StatsTip.vue'
import { useStatsTip } from '../../composables/useStatsTip'
import { colorHex } from '../../utils/tabColor.js'
import { connDatabases } from '../../stores/connectionData.js'
import { tagOverrides } from '../../stores/nodeTags'
import { useConnectionTree } from '../../composables/useConnectionTree.js'

const props = defineProps({
  width: { type: Number, default: 320 },
})
const emit = defineEmits(['select-collection'])

const {
  expandedConns, loadingConns, connErrors, expandedDbs, selectedKey,
  searchText, sidebarEl, filtered, setSelection, clearSelection, selectConnection,
  retryConnection, toggleDatabase, highlightCollection, activeCollectionKey,
  openCollection, collectionKey,
} = useConnectionTree({ emit })

// The colour name explicitly set on a node — its override (keyed by the node's
// full path) wins, otherwise the persisted fallback tag (connections only).
// Returns null when the node has no colour of its own (untagged or 'none').
function nodeTag(key, fallbackTag) {
  const override = tagOverrides.value[key]
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
  contextMenu.value = { type: type, x: e.clientX, y: e.clientY, label: label, nodeData: nodeData }
}
// Hovering a database or collection row pops its stats card (see useStatsTip). The rows
// pass their own target, so the card needs no per-kind handler here.
const { tip, ...statsTip } = useStatsTip()

// The registry moved to stores/openConnections, so the only thing left worth exposing
// is the one genuinely visual question: open whatever row the user has highlighted.
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
            'ctx-sel': contextActiveNodeKey === conn.id,
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
          <span class="err-retry" @click.stop="retryConnection(conn)">Retry</span>
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
                'ctx-sel': contextActiveNodeKey === conn.id + '/' + db.name,
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
                  'ctx-sel': contextActiveNodeKey === collectionKey(conn.id, db.name, coll),
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

<style src="./ConnectionTree.css" scoped></style>
