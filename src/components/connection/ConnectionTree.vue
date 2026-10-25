<script setup>
import { errTitle } from '../../utils/errors'
import { contextMenu, contextActiveNodeKey } from '../../stores/contextMenu'
import BaseIcon from '../base/BaseIcon.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import StatsTip from './StatsTip.vue'
import { useStatsTip } from '../../composables/useStatsTip'
import { colorHex, nodeTagName } from '../../utils/tabColor.js'
import { connDatabases } from '../../stores/connectionData.js'
import { tagOverrides } from '../../stores/nodeTags'
import { useConnectionTree } from '../../composables/useConnectionTree.js'
import { TREE_NODES } from '../../engines/ui.js'
import EngineBadge from '../base/EngineBadge.vue'
import { connectionMenu } from '../../engines/contextActions.js'
import { createResourceRef } from '../../utils/resourceRef'

const props = defineProps({
  width: { type: Number, default: 320 },
})

const {
  expandedConns, loadingConns, connErrors,
  searchText, sidebarEl, filtered, clearSelection, selectConnection,
  retryConnection, activeConnectionId,
} = useConnectionTree()

const nodeTag = (key, fallbackTag) => nodeTagName(tagOverrides.value, key, fallbackTag)

// Effective colours cascade down the tree: a node shows its own colour if it has
// one, otherwise it inherits the nearest coloured ancestor's (each engine's rows do the
// rest). Colouring a parent also resets its descendants (see App.vue) so they take the
// parent's colour even if they had their own — after which any of them can be
// re-coloured, and that own colour wins here again.
function connColor(conn) {
  return nodeTag(conn.id, conn.tag)
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

function onNodeContext(e, type, label, nodeData, items) {
  // The stats card opens at the pointer, which is exactly where the menu is about to
  // appear — drop it at once rather than leaving it to the hover grace period.
  statsTip.hide()
  contextMenu.value = { type: type, x: e.clientX, y: e.clientY, label: label, nodeData: nodeData, items }
}

// A connection whose engine has its own menu keeps the `connection` menu type (so colour
// tags and the right-click highlight work as for MongoDB) but offers only what works on it.
function onConnectionContext(e, conn) {
  const own = connectionMenu(conn)
  if (!own) return onNodeContext(e, 'connection', conn.name, { resource: createResourceRef(conn.id), connectionName: conn.name })
  onNodeContext(e, 'connection', conn.name, own.node, own.items)
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
            sel: activeConnectionId === conn.id,
            'ctx-sel': contextActiveNodeKey === conn.id,
            tagged: !!connColor(conn),
          }"
          :style="connColor(conn) ? { '--tag-color': colorHex(connColor(conn)) } : null"
          style="padding-left: 6px"
          @click="selectConnection(conn)"
          @contextmenu.prevent="onConnectionContext($event, conn)"
        >
          <span class="tw">
            <BaseIcon :name="expandedConns[conn.id] ? 'caretDown' : 'caret'" :size="12" />
          </span>
          <EngineBadge :engine="conn.engine" />
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
        <component
          :is="TREE_NODES[conn.engine]"
          v-if="expandedConns[conn.id] && connDatabases[conn.id]"
          :conn="conn"
          :resources="connDatabases[conn.id]"
          :stats-tip="statsTip"
        />
      </template>
    </div>

    <StatsTip :tip="tip" @keep="statsTip.keep" @leave="statsTip.hideSoon" @refresh="statsTip.refresh" />
  </div>
</template>

<style src="./ConnectionTree.css" scoped></style>
