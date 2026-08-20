<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, provide } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getKeybindings, getSettings, updateKeybindings, updateSettings } from './appApi/settings'
import { installInputUndo } from './utils/inputUndo'
import { parseField } from './utils/queryParser'
import { errText } from './utils/errors'
import { mergeBindings, matchBinding } from './utils/keybindings'
import { RELEASES_URL } from './constants/helpLinks'
import { useIndexes } from './composables/useIndexes'
import { useSshHostKey } from './composables/useSshHostKey'
import { useQueryRunner } from './composables/useQueryRunner'
import { useDbActions } from './composables/useDbActions'
import { useMenu } from './composables/useMenu'
import { useModals } from './composables/useModals'
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
  tabs, activeTabId, setRunRestoredTab,
  activateTab, moveTab, handleTabAction,
  renameTabTarget, renameTabValue, confirmRenameTab,
} from './stores/tabs'
import ConnectionTree from './components/connection/ConnectionTree.vue'
import WorkspaceArea from './components/workspace/WorkspaceArea.vue'
import ContextMenu from './components/base/ContextMenu.vue'
import AppModals from './components/app/AppModals.vue'
import Resizer from './components/base/Resizer.vue'
import Toolbar from './components/app/Toolbar.vue'
import OperationsPane from './components/panes/OperationsPane.vue'

import { listen } from '@tauri-apps/api/event';

// On macOS/Windows the native menu registers the keyboard accelerators. On Linux
// it doesn't (WebKitGTK would swallow editing keys), so the webview keeps its own
// shortcut handling there. Detected from the webview's platform string.
const NATIVE_MENU_OWNS_SHORTCUTS = !/Linux/i.test(navigator.userAgent);

onMounted(async () => {
  // WebKitGTK has no native undo/redo for text fields — install our own so Ctrl+Z works.
  installInputUndo()

  // Native menu clicks arrive here; route them through the same handlers the
  // custom bar used. (menu.rs emits the clicked item's id.)
  listen('menu-action', (e) => handleMenuAction(e.payload))

  // The pop-out document editor emits this after a save. Re-run any open collection tab
  // that shows the affected collection so the grid reflects the edit (find tabs only —
  // runRestoredTab re-runs a tab's stored find query in place; aggregate tabs no-op).
  listen('document-saved', (e) => {
    const payload = e.payload || {}
    for (const tab of tabs.value) {
      if (tab.kind === 'collection' && tab.hasRun
          && tab.connectionId === payload.connId
          && tab.dbName === payload.db
          && tab.collectionName === payload.coll) {
        tab._restored = true
        runRestoredTab(tab)
      }
    }
  })

  // On Linux the native menu carries no accelerators (they'd swallow editing keys
  // on WebKitGTK — see menu.rs), so we keep our own keyboard shortcuts there. On
  // macOS/Windows the native menu owns the accelerators, so we don't double-bind.
  if (NATIVE_MENU_OWNS_SHORTCUTS === false) {
    window.addEventListener('keydown', onGlobalKeydown)
  }

  // Load persisted preferences so new tabs adopt the configured default limit.
  try {
    const settings = await getSettings()
    if (settings && Number(settings.default_query_limit)) {
      defaultQueryLimit.value = Number(settings.default_query_limit)
    }
    if (settings && settings.theme) applyTheme(settings.theme)
    if (settings && settings.default_result_view) defaultResultView.value = settings.default_result_view
    if (settings && typeof settings.restore_session === 'boolean') restoreSessionEnabled.value = settings.restore_session
    if (settings && Number(settings.editor_tab_width)) editorTabWidth.value = Number(settings.editor_tab_width)
    await loadZoom(settings && settings.ui_zoom)
  } catch (_) {}

  // Load custom keyboard shortcuts so the JS handler (Linux) honors rebinds.
  try {
    const overrides = await getKeybindings()
    keyBindings.value = mergeBindings(overrides)
  } catch (_) {}

  // Restore persisted database/collection colour tags so they survive a restart.
  await loadNodeTags()

  // Load the saved session (always, so a legacy file is migrated and validated)
  // and restore tabs only when the user opted in; wired before the save watcher.
  await initializeSession({ restore: restoreSessionEnabled.value })

  // Save on any change to the open tabs or the active tab.
  startAutoSave()

  // Not awaited: a slow or failed check must never hold up startup.
  updater.checkOnLaunch()
});

onUnmounted(() => {
  stopAutoSave()
  window.removeEventListener('keydown', onGlobalKeydown)
});

// ── app state ──────────────────────────────────────────────
// `tabs`/`activeTabId` come from stores/tabs.js and the creators from
// composables/useTabCreators.js (both imported above); the watch that keeps one tab
// open is registered below, once the creators exist.
const toast = ref(null)
let toastTimer = null
const connectionTreeRef = ref(null)
// The sidebar's current single-click selection and how many connections are open.
// Both feed `menuContext`, so the native menu enables items based on what's
// selected/open in the tree, not only on the active tab.
const treeSelection = ref(null)       // { connectionId, connectionName, dbName, collectionName, kind } | null
const treeConnectionCount = ref(0)
// A one-shot request routed from the native menu down to the active collection's
// ResultsPanel (which owns the editors and results view). Used for Document/Collection
// editing as well as the View menu's view-mode toggles and Refresh Document. Bumping
// `nonce` re-fires the panel's watcher; `action` is the menu item id.
const docMenuRequest = ref(null)      // { action, nonce } | null
const toolbarHidden = ref(false)      // View → Hide Global Toolbar toggle
const historyRequest = ref(null)      // View → History Manager: { nonce } signal to the QueryBar
const browserRequest = ref(null)      // File → Load: { nonce } signal to open the saved-query browser
const saveQueryRequest = ref(null)    // File → Save: { nonce } signal to open the save-query form
const dbClipboard = ref(null)         // Copy/Paste: { kind: 'collection'|'database', connId, connName, dbName, collName? }

// Open-state for every top-level modal (see useModals). Kept as an api object so it
// can be provided to AppModals.vue; destructured here for the dispatchers that set it.
const modalsApi = useModals()
// Only the refs App.vue itself touches are destructured here; the rest are consumed
// by useFeatures (via `modals: modalsApi`) and AppModals (via provide/inject).
const defaultQueryLimit = ref(50)     // from settings; applied to newly opened collection tabs
const theme = ref('dark')             // from settings; drives <html data-theme>
const defaultResultView = ref('table')// from settings; the view a freshly opened collection tab shows
const restoreSessionEnabled = ref(true) // from settings; whether to reopen last session's tabs on startup
const editorTabWidth = ref(4)         // from settings; spaces per indent in the query/shell editors
const preferencesInitialTab = ref('general') // which Preferences tab to open on (e.g. 'keyboard' from Help menu)
// Effective keyboard shortcuts (defaults + user overrides). The JS key handler
// reads these on Linux; the native menu reads the same persisted store at build.
const keyBindings = ref(mergeBindings(null))

// Apply a theme everywhere it needs to live: the ref (for the Preferences select),
// the <html> attribute (which the CSS tokens key off), and the localStorage mirror
// that lets both webviews pre-paint on next launch without a flash.
function applyTheme(next) {
  const value = next === 'light' ? 'light' : 'dark'
  theme.value = value
  document.documentElement.dataset.theme = value
  localStorage.setItem('s4t-theme', value)
}

// Persist + apply a theme chosen outside the Preferences dialog (e.g. the Quickstart
// tab's Quick Options). Mirrors what onPrefsSaved does, but saves the setting too so
// the choice survives a restart.
async function setTheme(next) {
  try {
    await updateSettings({ defaultQueryLimit: defaultQueryLimit.value, theme: next })
  } catch (_) {}
  applyTheme(next)
}

const expandConnectionId = ref(null)
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

// ── Operations pane (bottom dock) ──
// Backed by the backend registry; the rail "Operations" label toggles it.
const { operations, runningCount, clearFinished } = useOperations()
const { zoomIn, zoomOut, resetZoom, loadZoom } = useZoom({ showToast: showToast })
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
// Toast is an app-wide concern, so it's provided once here and injected by any
// component that needs it (see useToast) rather than bubbled up as a `toast` event.
provide('showToast', showToast)
// The default result view (Preferences → General) is injected by ResultsPanel as the
// fallback for a tab that has no view of its own yet.
provide('defaultResultView', defaultResultView)
// Editor indent width (Preferences → Appearance) is injected by every CodeEditor.
provide('editorTabWidth', editorTabWidth)

const { tagOverrides, loadNodeTags, applyColorTag } = useNodeTags()

const {
  openImportWizard,
  onWizardImported,
  exportDatabase,
  importDatabase,
} = useDbTransfer({
  showToast: showToast,
  connectionTreeRef: connectionTreeRef,
  openModal: modalsApi.openModal,
})

// Self-update. The launch check is silent; Help → Check for Updates… is the loud one.
const updater = useUpdater({
  showToast: showToast,
  openModal: modalsApi.openModal,
  closeModal: modalsApi.closeModal,
  openDownloadsPage: () => openUrl(RELEASES_URL).catch(() => showToast('Could not open link')),
})

const indexesApi = useIndexes({ showToast: showToast })
// App.vue only needs the bindings for the native Index menu / menuContext
// (selectedIndex). The full indexesApi is provided app-wide (see provide below);
// the Index Manager tab (IndexManagerPane) consumes the rest via inject.
const {
  selectedIndex,
} = indexesApi

const sshApi = useSshHostKey()
const {
  sshHostKeyPrompt,
  sshHostKeyChanged,
  onHostKeyTrust,
  onHostKeyCancel,
  onHostKeyForget,
} = sshApi

const { runQuery, runAggregate, cancelQuery, runRestoredTab } = useQueryRunner({ showToast: showToast })

// Tab operations live in stores/tabs.js (imported above) alongside the tab state.
// Registering the re-runner is what lets the store re-run a restored tab without
// reaching for the query runner.
setRunRestoredTab(runRestoredTab)

// The tab creators. They need the query runner and the settings-backed defaults, so
// they're constructed here rather than being importable free functions.
const {
  openCollectionTab,
  openSqlTab,
  openShellTab,
  openIndexManagerTab,
  openSchemaTab,
  openExportSource,
  openExportTab,
  openSearchTab, openCurrentOpsTab,
  openImportTab,
  openQuickstart,
} = useTabCreators({
  defaultQueryLimit: defaultQueryLimit,
  defaultResultView: defaultResultView,
  runQuery: runQuery,
  modalsApi: modalsApi,
  showToast: showToast,
})

// The workspace always keeps at least one tab open: closing the last tab reopens
// the Quickstart tab (the home screen) instead of leaving an empty, tab-less pane.
watch(() => tabs.value.length, (count) => {
  if (count === 0) openQuickstart()
})

// Tab right-click: the context menu itself is App.vue state, so this stays out of the store.
function onTabContext({ id, x, y }) {
  contextMenu.value = { type: 'tab', x: x, y: y, nodeData: { tabId: id } }
}

const { initializeSession, startAutoSave, stopAutoSave } = useSessionPersistence({
  runRestoredTab: runRestoredTab,
})

// dbActionsApi is consumed whole by useFeatures (dialog seeders + pasteClipboard)
// and AppModals (dialog state + confirm handlers, via provide/inject).
const dbActionsApi = useDbActions({ showToast: showToast, connectionTreeRef: connectionTreeRef, dbClipboard: dbClipboard })

const { menuTarget } = useMenu({ treeSelection: treeSelection, treeConnectionCount: treeConnectionCount, selectedIndex: selectedIndex })

// Node-action dispatch shared by right-click menus, the native menu, and the toolbar.
const { handleContextAction, handleTool, menuNode } = useFeatures({
  contextMenu: contextMenu,
  connectionTreeRef: connectionTreeRef, dbClipboard: dbClipboard,
  modals: modalsApi, dbActions: dbActionsApi,
  showToast: showToast, applyColorTag: applyColorTag, menuTarget: menuTarget,
  handleTabAction: handleTabAction, openCollectionTab: openCollectionTab,
  openShellTab: openShellTab, openIndexManagerTab: openIndexManagerTab, openSqlTab: openSqlTab,
  openSchemaTab: openSchemaTab,
  openSearchTab: openSearchTab, openCurrentOpsTab: openCurrentOpsTab,
  openExportSource: openExportSource, openImportWizard: openImportWizard,
  exportDatabase: exportDatabase, importDatabase: importDatabase,
})

// ── active collection tracking (for tree highlight) ────────
const activeCollectionKey = computed(() => {
  const t = tabs.value.find(x => x.id === activeTabId.value)
  return t?.kind === 'collection'
    ? `${t.connectionId}/${t.dbName}/${t.collectionName}`
    : null
})

const { handleMenuAction } = useAppMenuActions({
  modalsApi,
  preferencesInitialTab,
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
  connectionTreeRef,
  zoomIn,
  zoomOut,
  resetZoom,
  docMenuRequest,
  toolbarHidden,
})
// The menu bar's keyboard shortcuts, used on Linux only. Skip text fields and code
// editors so the webview keeps its native editing keys (the WebKitGTK swallow trap).
function onGlobalKeydown(e) {
  const t = e.target
  if (t && t.closest && t.closest('input, textarea, [contenteditable], .cm-editor, .monaco-editor')) {
    return
  }
  // Match the event against the current (possibly customized) bindings.
  const id = matchBinding(e, keyBindings.value)
  if (id) {
    e.preventDefault()
    handleMenuAction(id)
  }
}

function onManagerConnect(id) {
  modalsApi.closeModal('connectionManager')
  expandConnectionId.value = id
}

function onValidatorSaved(collName) {
  showToast(`Validator saved for "${collName}"`)
}

function onCopyQuery() {
  const tab = tabs.value.find(t => t.id === activeTabId.value)
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
  const tab = tabs.value.find(t => t.id === activeTabId.value)
  if (!tab || !clipboardQuery.value) return
  const q = clipboardQuery.value
  tab.mode       = q.mode
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

function onPrefsSaved(payload) {
  defaultQueryLimit.value = payload.defaultQueryLimit
  applyTheme(payload.theme)
  defaultResultView.value = payload.defaultResultView
  restoreSessionEnabled.value = payload.restoreSession
  editorTabWidth.value = payload.editorTabWidth
}

// Shortcuts editor saved: persist the new bindings and adopt them live. The JS
// handler picks them up immediately; the native menu bar reflects them on next
// launch (it's built once from the same store).
async function onKeybindingsSaved(bindings) {
  try {
    const saved = await updateKeybindings(bindings)
    keyBindings.value = mergeBindings(saved)
  } catch (e) {
    showToast(errText(e))
  }
}

// The registry dialogs that change the tree; each emits `saved` with the connection id.
const STRUCTURAL_DIALOGS = [
  'addCollection', 'addDatabase', 'addView', 'addBucket',
  'dropDatabase', 'dropCollection', 'renameCollection', 'duplicateCollection',
]
const refreshConn = (connId) => connectionTreeRef.value?.refreshConn(connId)

// Everything the extracted AppModals.vue needs, bundled behind one provide/inject.
// Grouped by concern; AppModals destructures each group back to the same identifier
// names the moved template already uses, so that template stays verbatim.
provide('appModals', {
  modals: modalsApi,
  indexes: indexesApi,
  ssh: sshApi,
  handlers: {
    setTheme: setTheme,
    onManagerConnect: onManagerConnect,
    onValidatorSaved: onValidatorSaved,
    onWizardImported: onWizardImported,
    openImportTab: openImportTab,
    onPrefsSaved: onPrefsSaved,
    onKeybindingsSaved: onKeybindingsSaved,
  },
  // Extra domain events for registry-driven modals: modal id → { eventName: handler }.
  // `close` is wired generically by AppModals; only the modal's other events go here.
  modalEmits: {
    validator: { saved: onValidatorSaved },
    import: {
      configure: (format) => {
        openImportTab(modalsApi.openModals.import, format)
        modalsApi.closeModal('import')
      },
    },
    exportSource: {
      choose: (source) => {
        openExportTab(modalsApi.openModals.exportSource, source)
        modalsApi.closeModal('exportSource')
      },
    },
    connectionManager: { connect: onManagerConnect },
    update: { install: updater.install, downloads: updater.openDownloads },
    // Structural dialogs create/drop/rename things in the tree, so the sidebar needs a
    // refresh once they succeed. The dialog owns the driver call and its own form state;
    // only the refresh comes back here, since the tree ref lives in App.vue.
    ...Object.fromEntries(STRUCTURAL_DIALOGS.map(id => [id, { saved: refreshConn }])),
    preferences: {
      saved: onPrefsSaved,
      'saved-keybindings': onKeybindingsSaved,
    },
  },
  // Extra props for registry-driven modals that need app-level state beyond their target:
  // modal id → () => props object, re-read on each render so reactive values stay current.
  modalProps: {
    update: () => updater.dialogProps.value,
    preferences: () => ({
      defaultQueryLimit: defaultQueryLimit.value,
      theme: theme.value,
      defaultResultView: defaultResultView.value,
      restoreSession: restoreSessionEnabled.value,
      editorTabWidth: editorTabWidth.value,
      bindings: keyBindings.value,
      initialTab: preferencesInitialTab.value,
    }),
  },
  prefs: { defaultQueryLimit: defaultQueryLimit, theme: theme, keyBindings: keyBindings },
  tabRename: { renameTabTarget: renameTabTarget, renameTabValue: renameTabValue, confirmRenameTab: confirmRenameTab },
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
        :expand-id="expandConnectionId"
        :tag-overrides="tagOverrides"
        :context-active-node-key="contextActiveNodeKey"
        @select-collection="openCollectionTab"
        @select-node="treeSelection = $event"
        @connections-changed="treeConnectionCount = $event"
        @expanded="expandConnectionId = null"
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
