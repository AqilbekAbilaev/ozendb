<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, provide } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { parseField } from './utils/queryParser'
import { setCollectionQueryMode } from './utils/queryMode'
import { refreshFindWorkspacesAfterDocumentSave } from './utils/documentSaveRefresh'
import { sessionRestoreNotice } from './utils/sessionMigration'
import { matchBinding } from './utils/keybindings'
import { errText } from './utils/errors'
import { describeError } from './utils/errorReport'
import { recordFrontendError } from './appApi/errorLog'
import { RELEASES_URL } from './constants/helpLinks'
import { useIndexes } from './composables/useIndexes'
import { useSshHostKey } from './composables/useSshHostKey'
import { useQueryRunner } from './composables/useQueryRunner'
import { useDbActions } from './composables/useDbActions'
import { useMenu } from './composables/useMenu'
import { useUpdater } from './composables/useUpdater'
import { useOperations } from './composables/useOperations'
import { useNodeTags } from './composables/useNodeTags'
import { useDbTransfer } from './composables/useDbTransfer'
import { useFeatures } from './composables/useFeatures'
import { useSessionPersistence } from './composables/useSessionPersistence'
import { useZoom } from './composables/useZoom'
import { useTabCreators } from './composables/useTabCreators'
import { useAppMenuActions } from './composables/useAppMenuActions'
import {
  tabs, activeTabId, activeTab,
  activateTab, closeTab, moveTab, handleTabAction,
} from './stores/tabs'
import {
  defaultQueryLimit,
  defaultResultView,
  editorTabWidth,
  keyBindings,
  loadSettings,
  restoreSessionEnabled,
} from './stores/settings'
import ConnectionTree from './components/connection/ConnectionTree.vue'
import WorkspaceArea from './components/workspace/WorkspaceArea.vue'
import ContextMenu from './components/base/ContextMenu.vue'
import AppModals from './components/app/AppModals.vue'
import Resizer from './components/base/Resizer.vue'
import Toolbar from './components/app/Toolbar.vue'
import OperationsPane from './components/panes/OperationsPane.vue'

import { listen } from '@tauri-apps/api/event';

// Linux's WebKitGTK swallows the accelerators the native menu would otherwise own,
// so the webview keeps its own shortcut handling there instead.
const NATIVE_MENU_OWNS_SHORTCUTS = !/Linux/i.test(navigator.userAgent);

let unlisten = []

onMounted(async () => {
  unlisten = [
    // menu.rs emits the clicked item's id here.
    listen('menu-action', (e) => handleMenuAction(e.payload)),
    // The pop-out editor emits this after a save; refresh matching Find tabs explicitly,
    // since that isn't part of the restored-workspace lifecycle.
    listen('document-saved', (e) => {
      refreshFindWorkspacesAfterDocumentSave(tabs.value, e.payload, runQuery)
    }),
  ]

  if (NATIVE_MENU_OWNS_SHORTCUTS === false) {
    window.addEventListener('keydown', onGlobalKeydown)
  }

  // Settings must load before restoring tabs so new workspaces use the stored defaults.
  try {
    await loadSettings()
  } catch (e) {
    // Defaults keep the app usable, so the only symptom is preferences appearing to be
    // ignored — say so rather than letting the user think they never saved.
    showToast(`Could not load settings — using defaults. ${errText(e)}`)
    recordFrontendError(`loadSettings: ${describeError(e)}`).catch(() => {})
  }

  // Session load always runs (migrates/validates a legacy file); tab restore is opt-in.
  const session = await initializeSession({ restore: restoreSessionEnabled.value })
  const notice = sessionRestoreNotice(session)
  if (notice.toast) showToast(notice.toast)
  if (notice.log) recordFrontendError(notice.log).catch(() => {})

  startAutoSave()

  // Not awaited: a slow or failed check must never hold up startup.
  updater.checkOnLaunch()
});

onUnmounted(() => {
  stopAutoSave()
  unlisten.forEach(p => p.then(off => off()))
  window.removeEventListener('keydown', onGlobalKeydown)
});

const toast = ref(null)
let toastTimer = null
const connectionTreeRef = ref(null)
// Feeds menuContext, so the native menu reflects tree selection, not just the active tab.
const treeSelection = ref(null)       // { connectionId, connectionName, dbName, collectionName, kind } | null
const treeConnectionCount = ref(0)
// One-shot request from the native menu to the active collection's ResultsPanel; bumping
// `nonce` re-fires its watcher, `action` is the menu item id.
const docMenuRequest = ref(null)      // { action, nonce } | null
const toolbarHidden = ref(false)      // View → Hide Global Toolbar toggle
const historyRequest = ref(null)      // View → History Manager: { nonce } signal to the QueryBar
const browserRequest = ref(null)      // File → Load: { nonce } signal to open the saved-query browser
const saveQueryRequest = ref(null)    // File → Save: { nonce } signal to open the save-query form
const dbClipboard = ref(null)         // Copy/Paste: { kind: 'collection'|'database', connId, connName, dbName, collName? }

const vqbOpen        = ref(false)
const clipboardQuery = ref(null)
const contextMenu = ref(null)

const contextActiveNodeKey = computed(() => {
  if (!contextMenu.value) return null
  const nd = contextMenu.value.nodeData
  if (contextMenu.value.type === 'connection') return nd.connId
  if (contextMenu.value.type === 'database') return nd.connId + '/' + nd.dbName
  return nd.connId + '/' + nd.dbName + '/' + nd.collName
})
const sidebarWidth = ref(320)
const sidebarOpen = ref(true)   // the "Open connections" rail entry toggles the tree

const { operations, runningCount, clearFinished } = useOperations()
const { zoomIn, zoomOut, resetZoom } = useZoom({ showToast: showToast })
const operationsPaneOpen = ref(false)
const operationsPaneHeight = ref(200)

function toggleOperationsPane() {
  operationsPaneOpen.value = !operationsPaneOpen.value
}

function showToast(msg) {
  clearTimeout(toastTimer)
  toast.value = msg
  toastTimer = setTimeout(() => { toast.value = null }, 2200)
}
// Provided once here (rather than bubbled as an event) since toast is an app-wide concern.
provide('showToast', showToast)
provide('defaultResultView', defaultResultView)
provide('editorTabWidth', editorTabWidth)

const { tagOverrides, applyColorTag } = useNodeTags()

// The launch check below is silent; Help → Check for Updates… is the loud one.
const updater = useUpdater({
  showToast: showToast,
  openDownloadsPage: () => openUrl(RELEASES_URL).catch(() => showToast('Could not open link')),
})

const indexesApi = useIndexes({ showToast: showToast })
// Only the Index-menu binding is needed here; IndexManagerPane consumes the rest via inject.
const {
  selectedIndex,
} = indexesApi

const sshApi = useSshHostKey()

const { runQuery, runAggregate, cancelQuery } = useQueryRunner({ showToast: showToast })

// Constructed here, not as free functions, since they need the query runner and settings defaults.
const {
  openCollectionTab,
  openSqlTab,
  openShellTab,
  openIndexManagerTab,
  openSchemaTab,
  openExportSource,
  openSearchTab, openCurrentOpsTab,
  openImportTab,
  openQuickstart,
} = useTabCreators({
  defaultQueryLimit: defaultQueryLimit,
  defaultResultView: defaultResultView,
  runQuery: runQuery,
})

const {
  openImportWizard,
  exportDatabase,
  importDatabase,
} = useDbTransfer({
  showToast: showToast,
  openImportTab: openImportTab,
})

// Closing the last tab reopens Quickstart instead of leaving an empty, tab-less pane.
watch(() => tabs.value.length, (count) => {
  if (count === 0) openQuickstart()
})

function onTabContext({ id, x, y }) {
  contextMenu.value = { type: 'tab', x: x, y: y, nodeData: { tabId: id } }
}

const { initializeSession, startAutoSave, stopAutoSave } = useSessionPersistence()

const dbActionsApi = useDbActions({ showToast: showToast, dbClipboard: dbClipboard })

const { menuTarget } = useMenu({ treeSelection: treeSelection, treeConnectionCount: treeConnectionCount, selectedIndex: selectedIndex })

const { handleContextAction, handleTool, menuNode, refreshAll } = useFeatures({
  contextMenu: contextMenu,
  connectionTreeRef: connectionTreeRef, dbClipboard: dbClipboard,
  dbActions: dbActionsApi,
  showToast: showToast, applyColorTag: applyColorTag, menuTarget: menuTarget,
  handleTabAction: handleTabAction, openCollectionTab: openCollectionTab,
  openShellTab: openShellTab, openIndexManagerTab: openIndexManagerTab, openSqlTab: openSqlTab,
  openSchemaTab: openSchemaTab,
  openSearchTab: openSearchTab, openCurrentOpsTab: openCurrentOpsTab,
  openExportSource: openExportSource, openImportWizard: openImportWizard,
  exportDatabase: exportDatabase, importDatabase: importDatabase,
})

const activeCollectionKey = computed(() => {
  const t = activeTab.value
  return t?.kind === 'collection'
    ? `${t.connectionId}/${t.dbName}/${t.collectionName}`
    : null
})

const { handleMenuAction } = useAppMenuActions({
  openQuickstart,
  updater,
  menuTarget,
  openCollectionTab,
  vqbOpen,
  handleTool,
  menuNode,
  showToast,
  browserRequest,
  saveQueryRequest,
  historyRequest,
  refreshAll,
  zoomIn,
  zoomOut,
  resetZoom,
  docMenuRequest,
  toolbarHidden,
})
// Linux only; skip text fields/editors so the webview keeps its native editing keys.
function onGlobalKeydown(e) {
  const t = e.target
  if (t && t.closest && t.closest('input, textarea, [contenteditable], .cm-editor, .monaco-editor')) {
    return
  }
  const id = matchBinding(e, keyBindings.value)
  if (id) {
    e.preventDefault()
    handleMenuAction(id)
  }
}

function onCopyQuery() {
  const tab = activeTab.value
  if (!tab) return
  clipboardQuery.value = {
    mode:       tab.mode       || 'find',
    filter:     tab.filter     || '',
    sort:       tab.sort       || '',
    projection: tab.projection || '',
    skip:       tab.skip       ?? 0,
    limit:      tab.limit      ?? 50,
    pipeline:   tab.pipeline   || '',
  }
  showToast('Query copied.')
}
async function onPasteQuery() {
  const tab = activeTab.value
  if (!tab || !clipboardQuery.value) return
  const q = clipboardQuery.value
  setCollectionQueryMode(tab, q.mode)
  tab.filter     = q.filter
  tab.sort       = q.sort
  tab.projection = q.projection
  tab.skip       = Number(q.skip)
  tab.limit      = Number(q.limit)
  tab.pipeline   = q.pipeline
  if (q.mode !== 'find') return
  const pf = parseField(q.filter     || '')
  const ps = parseField(q.sort       || '')
  const pp = parseField(q.projection || '')
  await nextTick()
  runQuery(tab.id, {
    filter:     pf.ok ? pf.ejson : '{}',
    sort:       ps.ok ? ps.ejson : '{}',
    projection: pp.ok ? pp.ejson : '{}',
    skip:       Number(q.skip),
    limit:      Number(q.limit),
  })
}

// indexesApi/sshApi can't move to a store as-is: useIndexes needs App.vue's showToast
// (only reachable via inject, which needs a component context), and useSshHostKey
// registers its Tauri listeners inside onMounted. Everyone else reads stores/modals.js
// and stores/tabs.js directly instead of going through this bundle.
provide('appModals', {
  indexes: indexesApi,
  ssh: sshApi,
})
</script>

<template>
  <div class="app-layout">
    <!-- The menu bar is the native OS menu (installed from src-tauri/src/menu.rs);
         see handleMenuAction for how its clicks are routed back into the app. -->

    <!-- Toolbar -->
    <Toolbar :hidden="toolbarHidden" @tool="handleTool" />

    <!-- Main row -->
    <div class="app-main">
      <!-- Left rail -->
      <div class="rail-left">
        <button
          class="rail-toggle"
          :class="{ active: sidebarOpen }"
          type="button"
          :title="sidebarOpen ? 'Hide connections' : 'Show connections'"
          @click="sidebarOpen = !sidebarOpen"
        >
          <span class="rail-label">{{ sidebarOpen ? 'Hide connections' : 'Show connections' }}</span>
        </button>
        <button
          class="rail-toggle"
          :class="{ active: operationsPaneOpen }"
          style="margin-top:auto"
          type="button"
          :title="operationsPaneOpen ? 'Hide operations' : 'Show operations'"
          @click="toggleOperationsPane"
        >
          <span class="rail-label">Operations</span>
          <span v-if="runningCount" class="rail-badge">{{ runningCount }}</span>
        </button>
      </div>

      <!-- Sidebar -->
      <ConnectionTree
        v-show="sidebarOpen"
        ref="connectionTreeRef"
        :width="sidebarWidth"
        :active-collection-key="activeCollectionKey"
        :tag-overrides="tagOverrides"
        :context-active-node-key="contextActiveNodeKey"
        @select-collection="openCollectionTab"
        @select-node="treeSelection = $event"
        @connections-changed="treeConnectionCount = $event"
        @context-menu="contextMenu = $event"
      />
      <Resizer v-show="sidebarOpen" v-model="sidebarWidth" axis="x" :min="200" :max="560" />

      <!-- Workspace -->
      <WorkspaceArea
        :tabs="tabs"
        :active-tab-id="activeTabId"
        :tag-overrides="tagOverrides"
        :vqb-open="vqbOpen"
        :clipboard-query="clipboardQuery"
        :doc-menu-request="docMenuRequest"
        :history-request="historyRequest"
        :browser-request="browserRequest"
        :save-query-request="saveQueryRequest"
        @activate-tab="activateTab"
        @close-tab="closeTab"
        @reorder-tab="moveTab"
        @tab-context="onTabContext"
        @run-query="runQuery"
        @run-aggregate="runAggregate"
        @cancel-query="cancelQuery"
        @toggle-vqb="vqbOpen = !vqbOpen"
        @open-vqb="vqbOpen = true"
        @close-vqb="vqbOpen = false"
        @copy-query="onCopyQuery"
        @paste-query="onPasteQuery"
        @follow-reference="openCollectionTab"
      />
    </div>

    <!-- Operations dock (bottom) -->
    <template v-if="operationsPaneOpen">
      <Resizer v-model="operationsPaneHeight" axis="y" :min="120" :max="560" invert />
      <div class="ops-dock" :style="{ height: operationsPaneHeight + 'px' }">
        <OperationsPane
          :operations="operations"
          @clear="clearFinished"
          @close="operationsPaneOpen = false"
        />
      </div>
    </template>

    <!-- Context menu -->
    <ContextMenu
      v-if="contextMenu"
      :menu="contextMenu"
      @close="contextMenu = null"
      @pick="handleContextAction"
    />

    <AppModals />

    <!-- Toast -->
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style src="./App.css" scoped></style>
