<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, provide } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { installInputUndo } from './utils/inputUndo'
import { parseField } from './utils/queryParser'
import { errText } from './utils/errors'
import { mergeBindings, matchBinding } from './utils/keybindings'
import { useIndexes } from './composables/useIndexes'
import { useSshHostKey } from './composables/useSshHostKey'
import { useQueryRunner } from './composables/useQueryRunner'
import { useTabs } from './composables/useTabs'
import { useDbActions } from './composables/useDbActions'
import { useMenu } from './composables/useMenu'
import { useModals } from './composables/useModals'
import { useOperations } from './composables/useOperations'
import { useNodeTags } from './composables/useNodeTags'
import { useDbTransfer } from './composables/useDbTransfer'
import { useFeatures } from './composables/useFeatures'
import { useSessionPersistence } from './composables/useSessionPersistence'
import ConnectionTree from './components/connection/ConnectionTree.vue'
import QueryWorkspace from './components/query/QueryWorkspace.vue'
import ContextMenu from './components/base/ContextMenu.vue'
import AppModals from './components/app/AppModals.vue'
import Resizer from './components/base/Resizer.vue'
import Toolbar from './components/app/Toolbar.vue'
import OperationsPane from './components/app/OperationsPane.vue'

import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

const appWindow = getCurrentWindow();

// On macOS/Windows the native menu registers the keyboard accelerators. On Linux
// it doesn't (WebKitGTK would swallow editing keys), so the webview keeps its own
// shortcut handling there. Detected from the webview's platform string.
const NATIVE_MENU_OWNS_SHORTCUTS = !/Linux/i.test(navigator.userAgent);

appWindow.listen('window-focus', async (event) => {
  if (event.payload === true) {
    await appWindow.setFocus();
  }
});

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
    const settings = await invoke('get_settings')
    if (settings && Number(settings.default_query_limit)) {
      defaultQueryLimit.value = Number(settings.default_query_limit)
    }
    if (settings && settings.theme) applyTheme(settings.theme)
    if (settings && settings.default_result_view) defaultResultView.value = settings.default_result_view
    if (settings && typeof settings.restore_session === 'boolean') restoreSessionEnabled.value = settings.restore_session
    if (settings && Number(settings.editor_tab_width)) editorTabWidth.value = Number(settings.editor_tab_width)
  } catch (_) {}

  // Load custom keyboard shortcuts so the JS handler (Linux) honors rebinds.
  try {
    const overrides = await invoke('get_keybindings')
    keyBindings.value = mergeBindings(overrides)
  } catch (_) {}

  // Restore persisted database/collection colour tags so they survive a restart.
  await loadNodeTags()

  // Restore the previous session's tabs before wiring up the save watcher, so the
  // empty default never overwrites tabs.json first. Skipped when the user turned
  // session restore off (the save watcher below still keeps tabs.json current).
  if (restoreSessionEnabled.value) await restoreSession()

  // Save on any change to the open tabs or the active tab.
  startAutoSave()
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
});

// ── toolbar definition ─────────────────────────────────────
// ── app state ──────────────────────────────────────────────
const tabs = ref([
  { id: 't0', kind: 'quickstart', title: 'Quickstart' }
])
const activeTabId = ref('t0')

// The workspace always keeps at least one tab open: closing the last tab reopens
// the Quickstart tab (the home screen) instead of leaving an empty, tab-less pane.
// openQuickstart is a hoisted function declaration, so referencing it here is safe.
watch(() => tabs.value.length, (count) => {
  if (count === 0) openQuickstart()
})
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
    await invoke('update_settings', { defaultQueryLimit: defaultQueryLimit.value, theme: next })
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
  openExportWizard,
  openImportWizard,
  onWizardImported,
  exportDatabase,
  importDatabase,
} = useDbTransfer({
  showToast: showToast,
  connectionTreeRef: connectionTreeRef,
  openModal: modalsApi.openModal,
})

const indexesApi = useIndexes({ showToast: showToast })
// App.vue only needs the bindings for the native Index menu / menuContext
// (selectedIndex). The full indexesApi is provided app-wide (see provide below);
// the Index Manager tab (IndexManagerPane) consumes the rest via inject.
const {
  selectedIndex,
  startEditIndex,
  openIndexDetails,
  copyIndex,
  openDropIndexConfirm,
  setIndexHidden,
} = indexesApi

const sshApi = useSshHostKey()
const {
  sshHostKeyPrompt,
  sshHostKeyChanged,
  onHostKeyTrust,
  onHostKeyCancel,
  onHostKeyForget,
} = sshApi

const { runQuery, runAggregate, cancelQuery, runRestoredTab } = useQueryRunner({ tabs: tabs, showToast: showToast })

// Tab operations (activate/close/cycle/duplicate/rename + tab context menu). The
// tab state (tabs/activeTabId) stays in App.vue as the spine; the tab creators
// (openCollectionTab/openShellTab/openIndexManagerTab/openQuickstart) stay too, as
// they depend on the query runner and settings.
const {
  activateTab, cycleTab, closeTab, moveTab, onTabContext, handleTabAction,
  renameTabTarget, renameTabValue, confirmRenameTab,
} = useTabs({ tabs: tabs, activeTabId: activeTabId, contextMenu: contextMenu, runRestoredTab: runRestoredTab })

const { restoreSession, startAutoSave } = useSessionPersistence({
  tabs: tabs,
  activeTabId: activeTabId,
  runRestoredTab: runRestoredTab,
})

// dbActionsApi is consumed whole by useFeatures (dialog seeders + pasteClipboard)
// and AppModals (dialog state + confirm handlers, via provide/inject).
const dbActionsApi = useDbActions({ tabs: tabs, activeTabId: activeTabId, showToast: showToast, connectionTreeRef: connectionTreeRef, dbClipboard: dbClipboard })

const { menuTarget } = useMenu({ tabs: tabs, activeTabId: activeTabId, treeSelection: treeSelection, treeConnectionCount: treeConnectionCount, selectedIndex: selectedIndex })

// Node-action dispatch (right-click menu, native menu bar via menuNode, toolbar).
// handleMenuAction (the menu-bar spine) stays in App.vue and calls into these.
const { handleContextAction, handleTool, menuNode } = useFeatures({
  contextMenu: contextMenu, tabs: tabs, activeTabId: activeTabId,
  connectionTreeRef: connectionTreeRef, dbClipboard: dbClipboard,
  modals: modalsApi, dbActions: dbActionsApi,
  showToast: showToast, applyColorTag: applyColorTag, menuTarget: menuTarget,
  handleTabAction: handleTabAction, openCollectionTab: openCollectionTab,
  openShellTab: openShellTab, openIndexManagerTab: openIndexManagerTab, openSqlTab: openSqlTab,
  openSchemaTab: openSchemaTab, openMaskingTab: openMaskingTab,
  openSearchTab: openSearchTab, openTasksTab: openTasksTab,
  openExportWizard: openExportWizard, openImportWizard: openImportWizard,
  exportDatabase: exportDatabase, importDatabase: importDatabase,
})

// ── active collection tracking (for tree highlight) ────────
const activeCollectionKey = computed(() => {
  const t = tabs.value.find(x => x.id === activeTabId.value)
  return t?.kind === 'collection'
    ? `${t.connectionId}/${t.dbName}/${t.collectionName}`
    : null
})

// Help-menu link targets. Default to the project's real GitHub repo (from the git
// remote); retarget as needed once dedicated pages exist.
const HELP_REPO = 'https://github.com/AqilbekAbilaev/ozendb'
const HELP_URLS = {
  'help:license':         HELP_REPO,
  'help:gallery':         `${HELP_REPO}#readme`,
  'help:whats_new':       `${HELP_REPO}/releases`,
  'help:updates':         `${HELP_REPO}/releases`,
  'help:support':         `${HELP_REPO}/issues`,
  'help:feature_request': `${HELP_REPO}/issues/new`,
  'help:feedback':        `${HELP_REPO}/issues/new`,
  'help:tutorials':       `${HELP_REPO}/wiki`,
  'help:knowledge_base':  `${HELP_REPO}/wiki`,
}

// Dispatch an Index menu action to the active Index Manager tab. Each tab owns
// its own state (selectedIndex, form, etc.) and exposes a handler API on the tab
// object via _idxApi. The menu only fires when the active tab is an index tab.
function indexMenuAction(method, ...args) {
  const tab = tabs.value.find(t => t.id === activeTabId.value)
  if (tab && tab._idxApi && tab._idxApi[method]) tab._idxApi[method](...args)
}

// Routes menu-bar actions (emitted by id) to the same handlers the toolbar and
// right-click menus already use. The menu bar never emits a disabled item.
function handleMenuAction(id) {
  switch (id) {
    // --- direct modals / app ---
    case 'file:connect':     invoke('open_connect_window').catch(() => {}); return
    case 'file:exit':        appWindow.close(); return
    case 'edit:preferences': preferencesInitialTab.value = 'general'; modalsApi.openModal('preferences'); return
    case 'help:shortcuts':   preferencesInitialTab.value = 'keyboard'; modalsApi.openModal('preferences'); return
    case 'help:quickstart':  openQuickstart(); return
    case 'help:about':       modalsApi.openModal('about'); return
    // Help links open the project's GitHub (issues / releases / repo). Configurable —
    // retarget any URL in HELP_URLS.
    case 'help:license':
    case 'help:gallery':
    case 'help:whats_new':
    case 'help:updates':
    case 'help:support':
    case 'help:feature_request':
    case 'help:feedback':
    case 'help:tutorials':
    case 'help:knowledge_base':
      openUrl(HELP_URLS[id]).catch(() => showToast('Could not open link'))
      return
    case 'coll:vqb': {
      const tab = menuTarget('collection')
      if (!tab || tab.kind !== 'collection' || !tab.collectionName) {
        showToast('Open a collection first')
        return
      }
      openCollectionTab({
        connectionId: tab.connectionId,
        connectionName: tab.connectionName,
        dbName: tab.dbName,
        collectionName: tab.collectionName,
      })
      vqbOpen.value = true
      return
    }

    // --- toolbar dispatcher (targets the sidebar selection, else the active tab) ---
    case 'file:intellishell': handleTool('shell', menuTarget('database')); return
    case 'file:sql':          handleTool('sql', menuTarget('collection')); return
    case 'file:tasks':        openTasksTab(); return
    // File → Load / Save: the saved-query browser and save-query form live in the
    // active collection tab's QueryBar; signal it (no-op with a toast otherwise).
    case 'file:load':
    case 'file:save': {
      const tab = tabs.value.find(t => t.id === activeTabId.value)
      if (!tab || tab.kind !== 'collection') { showToast('Open a collection tab first'); return }
      if (id === 'file:load') browserRequest.value = { nonce: Date.now() }
      else saveQueryRequest.value = { nonce: Date.now() }
      return
    }
    case 'file:search':       handleTool('search', menuTarget('database')); return
    case 'coll:open_tab':     handleTool('collection'); return
    case 'coll:export':       handleTool('export', menuTarget('collection')); return
    case 'coll:import':       handleTool('import', menuTarget('collection')); return
    case 'coll:mask':         handleTool('mask', menuTarget('collection')); return

    // --- server / connection scoped ---
    case 'file:server_status': menuNode('Server Status', 'connection'); return
    case 'file:server_charts': menuNode('Server Status Charts', 'connection'); return
    case 'file:server_build':  menuNode('Build Info', 'connection'); return
    case 'db:database_stats':  menuNode('Database Statistics', 'database'); return
    case 'db:current_ops':     menuNode('Current Operations', 'connection'); return
    case 'db:profiler':        menuNode('Query Profiler', 'database'); return

    // --- database scoped ---
    case 'db:add_collection':  menuNode('Add Collection…', 'database'); return
    case 'file:add_database':
    case 'db:add_database':    menuNode('Add Database…', 'connection'); return
    case 'db:add_view':        menuNode('Add View…', 'database'); return
    case 'coll:add_view':      menuNode('Add View Here…', 'collection'); return
    case 'coll:validator':     menuNode('Add / Edit Validator…', 'collection'); return
    case 'db:export':          menuNode('Export Collections…', 'database'); return
    case 'db:import':          menuNode('Import Collections…', 'database'); return
    case 'db:add_bucket':      menuNode('Add GridFS Bucket…', 'database'); return
    case 'db:manage_users':    menuNode('Manage Users', 'database'); return
    case 'db:manage_roles':    menuNode('Manage Roles', 'database'); return
    case 'db:functions':       menuNode('Stored Functions', 'database'); return
    case 'coll:mapreduce':     menuNode('Open Map-Reduce', 'collection'); return
    // Copy/Paste: copy a collection or database to the app clipboard, then paste it
    // into a target database (same connection). Copy All == Copy Database here.
    case 'coll:copy':          menuNode('Copy Collection', 'collection'); return
    case 'db:copy_database':   menuNode('Copy Database', 'database'); return
    case 'db:copy_all':        menuNode('Copy Database', 'database'); return
    case 'db:paste':
    case 'db:paste_database':  menuNode('Paste Into Database', 'database'); return
    case 'db:drop_database':   menuNode('Drop Database…', 'database'); return
    case 'gridfs:open':        menuNode('GridFS…', 'database'); return
    case 'gridfs:add':
    case 'gridfs:save':
    case 'gridfs:remove':
    case 'gridfs:view_file':
    case 'gridfs:rename':
    case 'gridfs:meta':
    case 'gridfs:copy_bucket':
    case 'gridfs:drop_bucket':
      requestGridfsAction(id); return

    // --- collection scoped ---
    case 'coll:aggregation':   menuNode('Open Aggregation Editor', 'collection'); return
    case 'coll:add_index':     menuNode('Indexes…', 'collection'); return

    // --- index scoped (act on the active tab's selected index) ---
    case 'idx:edit':   indexMenuAction('startEditIndex'); return
    case 'idx:view':   indexMenuAction('openIndexDetails'); return
    case 'idx:copy':   indexMenuAction('copyIndex'); return
    case 'idx:drop':   indexMenuAction('openDropIndexConfirm'); return
    case 'idx:hide':   indexMenuAction('setIndexHidden', true); return
    case 'idx:unhide': indexMenuAction('setIndexHidden', false); return
    case 'coll:stats':
    case 'db:collection_stats': menuNode('Collection Stats', 'collection'); return
    case 'coll:schema':        menuNode('View Schema', 'collection'); return
    case 'coll:history':       menuNode('Collection History', 'collection'); return
    case 'coll:rename':        menuNode('Rename Collection…', 'collection'); return
    case 'coll:duplicate':     menuNode('Duplicate Collection…', 'collection'); return
    case 'coll:drop':          menuNode('Drop Collection…', 'collection'); return

    // --- collection: document editing (open/activate a collection tab, then run) ---
    case 'coll:insert_document':
    case 'coll:update_dialog':
    case 'coll:delete_dialog':
    case 'coll:clear':
      requestCollectionDocAction(id); return

    // --- edit: clipboard copies act on the selected row/field in the active view ---
    case 'edit:copy':
    case 'edit:copy_value':
    case 'edit:copy_field':
    case 'edit:copy_field_path':
    case 'edit:copy_document':
      requestDocMenuAction(id); return

    // --- edit: paste inserts clipboard document(s) into the active collection ---
    case 'edit:paste_documents':
      requestCollectionDocAction(id); return

    // --- document: act on the selected row/field in the active results view ---
    case 'doc:edit_value':
    case 'doc:add_field':
    case 'doc:remove_field':
    case 'doc:rename_field':
    case 'doc:view_json':
    case 'doc:edit_json':
    case 'doc:delete':
      requestDocMenuAction(id); return

    // --- view ---
    case 'view:refresh':
      for (const conn of connectionTreeRef.value.getConnections()) {
        connectionTreeRef.value.refreshConn(conn.id)
      }
      showToast('Refreshed')
      return

    // Tab navigation/closing. Close Tab and Close Tab (No Prompt) behave the same
    // today — there is no unsaved-changes prompt to differ on yet.
    case 'view:next_tab':      cycleTab(1); return
    case 'view:prev_tab':      cycleTab(-1); return
    case 'view:close_tab':
    case 'view:close_tab_np':
      if (activeTabId.value != null) closeTab(activeTabId.value)
      return

    // Results view mode + Refresh Document act on the active collection tab's
    // ResultsPanel; signal it directly (no row selection required).
    case 'view:tree':
    case 'view:table':
    case 'view:json':
    case 'view:refresh_document':
    case 'view:step_column':
    case 'view:step_cell':
    case 'view:step_out': {
      const tab = tabs.value.find(t => t.id === activeTabId.value)
      if (!tab || tab.kind !== 'collection') { showToast('Open a collection tab first'); return }
      docMenuRequest.value = { action: id, nonce: Date.now() }
      return
    }

    // Toggle the global toolbar. The native menu label stays "Hide Global Toolbar";
    // a toast reports the resulting state.
    case 'view:hide_toolbar':
      toolbarHidden.value = !toolbarHidden.value
      showToast(toolbarHidden.value ? 'Toolbar hidden' : 'Toolbar shown')
      return

    // History Manager: open the active collection tab's query-history menu.
    case 'view:history': {
      const tab = tabs.value.find(t => t.id === activeTabId.value)
      if (!tab || tab.kind !== 'collection') { showToast('Open a collection tab first'); return }
      historyRequest.value = { nonce: Date.now() }
      return
    }
  }
}

// Route a Document-menu action to the active collection tab's ResultsPanel, which
// owns the field/document editors. The Document gates already guarantee an active
// collection tab with a selected row/field, so this only needs to signal the panel.
function requestDocMenuAction(action) {
  const tab = tabs.value.find(t => t.id === activeTabId.value)
  if (!tab || tab.kind !== 'collection' || (tab.selectedRow ?? -1) < 0) {
    showToast('Select a document in the results first')
    return
  }
  docMenuRequest.value = { action: action, nonce: Date.now() }
}

// Route a Collection document-editing action (Insert / Update / Delete dialog, Clear)
// to a collection's ResultsPanel. Resolve the target collection (sidebar selection or
// active tab), open it as a tab so its results view exists and can refresh, then — once
// that tab is mounted — signal the panel to open the matching dialog.
async function requestCollectionDocAction(action) {
  const target = menuTarget('collection')
  if (!target || target.kind !== 'collection' || !target.collectionName) {
    showToast('Open a collection first')
    return
  }
  const active = tabs.value.find(t => t.id === activeTabId.value)
  const sameCollectionActive = active && active.kind === 'collection'
    && active.connectionId === target.connectionId
    && active.dbName === target.dbName
    && active.collectionName === target.collectionName
  // Reuse the active tab when it already shows this collection; otherwise open one so
  // the operation has a results view to refresh afterward.
  if (!sameCollectionActive) {
    openCollectionTab({
      connectionId: target.connectionId,
      connectionName: target.connectionName,
      dbName: target.dbName,
      collectionName: target.collectionName,
    })
  }
  await nextTick()
  docMenuRequest.value = { action: action, nonce: Date.now() }
}

// The menu bar's keyboard shortcuts, used on Linux only (elsewhere the native
// menu's accelerators own them — see NATIVE_MENU_OWNS_SHORTCUTS). We skip when
// focus is in a text field or code editor so the webview keeps its native editing
// keys (the WebKitGTK swallow trap), and only claim our specific combos.
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

// The Validator modal owns its own fetch/save; we just confirm the result.
function onValidatorSaved(collName) {
  showToast(`Validator saved for "${collName}"`)
}

// ── tab management ─────────────────────────────────────────
async function openCollectionTab({ connectionId, connectionName, dbName, collectionName, filter }, startMode = 'find') {
  // Every open creates a new tab — the same collection may be opened in several
  // tabs (Studio-3T behavior). No dedup/focus-existing here by design.
  const id = 't' + Date.now()
  tabs.value.push({
    id: id, kind: 'collection',
    title: collectionName,
    connectionId: connectionId,
    connectionName: connectionName,
    dbName: dbName,
    collectionName: collectionName,
    filter: filter || '', projection: '', sort: '', skip: 0, limit: defaultQueryLimit.value,
    mode: startMode, pipeline: '',
    vqb: null,
    resultView: defaultResultView.value,
    results: [], hasRun: false, isRunning: false, runError: null,
    selectedRow: -1, selectedRows: [], elapsedMs: null,
  })
  activeTabId.value = id

  // Follow Reference (and any caller supplying a filter) runs that filter immediately,
  // bypassing the collection's saved default query.
  if (filter) {
    const pf = parseField(filter)
    runQuery(id, {
      filter:     pf.ok ? pf.ejson : '{}',
      projection: '{}',
      sort:       '{}',
      skip:       0,
      limit:      defaultQueryLimit.value,
    })
    return
  }

  let def = null
  try {
    def = await invoke('get_default_query', {
      connectionId: connectionId,
      database:     dbName,
      collection:   collectionName,
    })
  } catch (_) {}

  // Aggregation tabs open with an empty pipeline; nothing to run until the user writes one.
  if (startMode !== 'find') return

  if (def) {
    const tab = tabs.value.find(t => t.id === id)
    if (tab) {
      tab.filter     = def.filter     || ''
      tab.sort       = def.sort       || ''
      tab.projection = def.projection || ''
      tab.skip       = Number(def.skip)
      tab.limit      = Number(def.limit)
    }
    const pf = parseField(def.filter     || '')
    const ps = parseField(def.sort       || '')
    const pp = parseField(def.projection || '')
    runQuery(id, {
      filter:     pf.ok ? pf.ejson : '{}',
      sort:       ps.ok ? ps.ejson : '{}',
      projection: pp.ok ? pp.ejson : '{}',
      skip:       Number(def.skip),
      limit:      Number(def.limit),
    })
  } else {
    runQuery(id, { filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: defaultQueryLimit.value })
  }
}

// Opens (or re-focuses) a SQL query tab for a collection. It's a collection tab in
// `sql` mode: the query area shows a SQL editor, but the whole result stack (grid,
// paging, Query Code, Explain) is reused. One SQL tab per collection.
function openSqlTab({ connectionId, connectionName, dbName, collectionName }) {
  const existing = tabs.value.find(t =>
    t.kind === 'collection' && t.mode === 'sql' &&
    t.connectionId === connectionId && t.dbName === dbName && t.collectionName === collectionName)
  if (existing) { activeTabId.value = existing.id; return }
  const id = 't' + Date.now()
  tabs.value.push({
    id: id, kind: 'collection',
    title: 'SQL: ' + collectionName,
    connectionId: connectionId,
    connectionName: connectionName,
    dbName: dbName,
    collectionName: collectionName,
    filter: '', projection: '', sort: '', skip: 0, limit: defaultQueryLimit.value,
    mode: 'sql', pipeline: '',
    sql: 'SELECT *\nFROM ' + collectionName,
    sqlError: null,
    vqb: null,
    results: [], hasRun: false, isRunning: false, runError: null,
    selectedRow: -1, selectedRows: [], elapsedMs: null,
  })
  activeTabId.value = id
}

// Open an IntelliShell tab scoped to a connection + database. Each shell tab has
// its own backend JS session (sessionId), so variables persist across runs.
function openShellTab({ connectionId, connectionName, dbName }) {
  const id = 't' + Date.now()
  tabs.value.push({
    id: id, kind: 'shell',
    title: 'mongosh: ' + dbName,
    connectionId: connectionId,
    connectionName: connectionName,
    dbName: dbName,
    sessionId: (crypto.randomUUID ? crypto.randomUUID() : id),
    // editor + command history (dropdown)
    code: '', history: [], isRunning: false,
    // result state, read by the reused result grid (ResultTable / TreeView)
    results: [], resultView: 'table', resultTab: 'Console',
    runError: null, elapsedMs: null, drillPath: [], hasRun: false, selectedRow: -1, selectedRows: [],
    logs: [], scalar: undefined, hasScalar: false,
  })
  activeTabId.value = id
}

// Opens (or re-focuses) an Index Manager tab for a collection. The tab is a thin
// shell around the shared useIndexes state; IndexManagerPane loads it on mount.
function openIndexManagerTab({ connId, connName, dbName, collName }) {
  const existing = tabs.value.find(t =>
    t.kind === 'indexes' && t.connId === connId && t.dbName === dbName && t.collName === collName)
  if (existing) { activeTabId.value = existing.id; return }
  const id = 't' + Date.now()
  tabs.value.push({
    id: id, kind: 'indexes',
    title: 'Index Manager: ' + collName,
    connId: connId, connName: connName, dbName: dbName, collName: collName,
  })
  activeTabId.value = id
}

// Open (or focus) a collection-scoped tool tab — Studio-3T renders Schema, Data Masking,
// etc. as workspace tabs rather than modals. Reopening the same tool on the same
// collection focuses the existing tab.
function openCollectionToolTab(kind, titlePrefix, { connId, connName, dbName, collName }) {
  const existing = tabs.value.find(t =>
    t.kind === kind && t.connId === connId && t.dbName === dbName && t.collName === collName)
  if (existing) { activeTabId.value = existing.id; return }
  const id = 't' + Date.now()
  tabs.value.push({
    id: id, kind: kind, title: titlePrefix + ': ' + collName,
    connId: connId, connName: connName, dbName: dbName, collName: collName,
  })
  activeTabId.value = id
}
function openSchemaTab(node)   { openCollectionToolTab('schema', 'Schema', node) }
function openMaskingTab(node)  { openCollectionToolTab('masking', 'Masking', node) }

// Tasks is app-level (not tied to a connection) — a standalone workspace tab.
function openTasksTab() {
  const existing = tabs.value.find(t => t.kind === 'tasks')
  if (existing) { activeTabId.value = existing.id; return }
  const id = 't' + Date.now()
  tabs.value.push({ id: id, kind: 'tasks', title: 'Tasks' })
  activeTabId.value = id
}

// Search is database-scoped (it scans every collection in one db).
function openSearchTab({ connId, connName, dbName }) {
  const existing = tabs.value.find(t => t.kind === 'search' && t.connId === connId && t.dbName === dbName)
  if (existing) { activeTabId.value = existing.id; return }
  const id = 't' + Date.now()
  tabs.value.push({
    id: id, kind: 'search', title: 'Search: ' + dbName,
    connId: connId, connName: connName, dbName: dbName,
  })
  activeTabId.value = id
}

// Opens an Import tab for a collection with the format chosen in the picker. The
// pane (ImportPane) mutates the working state (sources, validate, preview) directly
// on the tab, so it survives tab switches; the persisted subset (format, validate,
// sources) lets the tab return on restart. Each source targets a db.collection on
// this connection; Run loops over the sources on the frontend.
function openImportTab({ connId, connName, dbName, collName }, format) {
  const id = 't' + Date.now()
  const base = {
    id: id, kind: 'import',
    title: 'Import: ' + collName,
    connId: connId, connName: connName, dbName: dbName, collName: collName,
    format: format,
  }
  if (format === 'csv') {
    // CSV is single-source with Source/Target sub-tabs and per-file CSV options.
    tabs.value.push({
      ...base,
      subTab: 'source',           // 'source' | 'target'
      sourceType: 'file',         // 'clipboard' | 'file'
      filePath: '',
      csv: { delimiter: ',', other: '', qualifier: '"', skipLines: 0, hasHeader: true },
      targetDb: dbName, targetColl: collName, mode: 'insert',
      fields: [],                 // column → field mapping (Target options)
    })
  } else {
    // JSON is a multi-source table.
    tabs.value.push({
      ...base,
      validate: false,
      sources: [],                // { path, name, targetDb, targetColl, mode }
      selectedSource: -1,
      previewOpen: false,
    })
  }
  activeTabId.value = id
}

// GridFS menu actions operate inside the GridFS modal on its selected file/bucket.
// Ensure the modal is open for the resolved database (preserving any existing
// selection when it's already showing that db), then signal the requested action.
async function requestGridfsAction(action) {
  const target = menuTarget('database')
  if (!target || !target.connectionId || !target.dbName) {
    showToast('Open a database first')
    return
  }
  const open = modalsApi.openModals.gridfs
  const sameOpen = open
    && open.connId === target.connectionId
    && open.dbName === target.dbName
  if (!sameOpen) {
    modalsApi.openModal('gridfs', {
      connId: target.connectionId,
      connName: target.connectionName,
      dbName: target.dbName,
    })
  }
  await nextTick()
  modalsApi.openModals.gridfs.menuRequest = { action: action, nonce: Date.now() }
}

// Help → Quickstart: focus the existing Quickstart tab, or open one if it was closed.
function openQuickstart() {
  const existing = tabs.value.find(t => t.kind === 'quickstart')
  if (existing) {
    activateTab(existing.id)
    return
  }
  const id = 't' + Date.now()
  tabs.value.push({ id: id, kind: 'quickstart', title: 'Quickstart' })
  activateTab(id)
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

// Preferences saved: adopt the new default query limit and apply the chosen theme.
// A named handler so it can cross the boundary into AppModals via the provided bundle.
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
    const saved = await invoke('update_keybindings', { bindings: bindings })
    keyBindings.value = mergeBindings(saved)
  } catch (e) {
    showToast(errText(e))
  }
}

// Everything the extracted AppModals.vue needs, bundled behind one provide/inject.
// Grouped by concern; AppModals destructures each group back to the same identifier
// names the moved template already uses, so that template stays verbatim.
provide('appModals', {
  modals: modalsApi,
  indexes: indexesApi,
  dbActions: dbActionsApi,
  ssh: sshApi,
  handlers: {
    setTheme: setTheme,
    onManagerConnect: onManagerConnect,
    onValidatorSaved: onValidatorSaved,
    onWizardImported: onWizardImported,
    openImportTab: openImportTab,
    onPrefsSaved: onPrefsSaved,
    onKeybindingsSaved: onKeybindingsSaved,
    openTasksTab: openTasksTab,
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
    connectionManager: { connect: onManagerConnect },
    preferences: {
      saved: onPrefsSaved,
      'saved-keybindings': onKeybindingsSaved,
    },
  },
  // Extra props for registry-driven modals that need app-level state beyond their target:
  // modal id → () => props object, re-read on each render so reactive values stay current.
  modalProps: {
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
      <QueryWorkspace
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
