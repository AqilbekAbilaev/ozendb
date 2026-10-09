import { nextTick, onMounted, onUnmounted } from 'vue'
import { showToast } from '../stores/toast'
import { openCollectionTab, openQuickstart, openPostgresQuery, openPostgresSearch } from '../stores/tabCreators'
import { useZoom } from './useZoom'
import { requestHistory, requestSaveQuery, requestSavedQueryBrowser, requestDocAction, requestRefresh, requestIndexAction } from '../stores/menuRequests'
import { onMenuAction } from '../appApi/events'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'
import { HELP_URLS, HELP_MODALS, isHelpLink } from '../constants/helpLinks'
import { tabs, activeTabId, activeTab, closeTab, cycleTab } from '../stores/tabs'
import { canRefreshWorkspace } from '../workspaces/lifecycle'
import { openModal, openModals } from '../stores/modals'
import { checkNow as checkForUpdates } from '../stores/updater'
import { vqbOpen } from '../stores/visualQueryBuilder'
import { keyBindings } from '../stores/settings'
import { matchBinding } from '../utils/keybindings'
import { isEditingTarget } from '../utils/editingTarget'

// Native menu items that run a feature registered under another id: two items, one
// action. Every other id that names a feature runs it directly.
export const MENU_ALIASES = {
  'file:add_database': 'db:add_database',
  'db:collection_stats': 'coll:stats',
  'db:copy_all': 'db:copy_database',
  'db:paste_database': 'db:paste',
}

// `menuTarget`/`pgMenuTarget` come from useMenu and the three dispatchers from
// useFeatures — App.vue constructs both once and hands over what this needs of
// them. `toolbarHidden` is App.vue's own layout state; the View menu just toggles it.
export function useAppMenuActions({ menuTarget, pgMenuTarget, handleTool, menuNode, knownActions, refreshAll, toolbarHidden }) {
  const { zoomIn, zoomOut, resetZoom } = useZoom()
  const appWindow = getCurrentWindow()

  // Routes menu-bar actions (emitted by id) to the same handlers the toolbar and
  // right-click menus already use. The menu bar never emits a disabled item.
  function handleMenuAction(id) {
    // Help items are tables, not switch arms: most open the project's GitHub, the rest
    // open an app-level modal (see constants/helpLinks).
    if (isHelpLink(id)) {
      openUrl(HELP_URLS[id]).catch(() => showToast('Could not open link'))
      return
    }
    if (HELP_MODALS[id]) { openModal(HELP_MODALS[id]); return }
    switch (id) {
      // --- direct modals / app ---
      case 'file:connect':     openModal('connectionManager'); return
      case 'file:exit':        appWindow.close(); return
      case 'edit:preferences': openModal('preferences', undefined, { props: { initialTab: 'general' } }); return
      case 'help:shortcuts':   openModal('preferences', undefined, { props: { initialTab: 'keyboard' } }); return
      case 'help:quickstart':  openQuickstart(); return
      case 'help:updates':     checkForUpdates(); return
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
      // File → Load / Save: the saved-query browser and save-query form live in the
      // active collection tab's QueryBar; signal it (no-op with a toast otherwise).
      case 'file:load':
      case 'file:save': {
        const tab = tabs.value.find(t => t.id === activeTabId.value)
        if (!tab || tab.kind !== 'collection') { showToast('Open a collection tab first'); return }
        if (id === 'file:load') requestSavedQueryBrowser()
        else requestSaveQuery()
        return
      }
      case 'file:search':       handleTool('search', menuTarget('database')); return
      case 'coll:open_tab':     handleTool('collection', menuTarget('collection')); return
      case 'coll:export':       handleTool('export', menuTarget('collection')); return
      case 'coll:import':       handleTool('import', menuTarget('collection')); return

      // --- GridFS (acts on the open GridFS dialog) ---
      case 'gridfs:add':
      case 'gridfs:save':
      case 'gridfs:remove':
      case 'gridfs:view_file':
      case 'gridfs:rename':
      case 'gridfs:meta':
      case 'gridfs:copy_bucket':
      case 'gridfs:drop_bucket':
        requestGridfsAction(id); return


      // --- index scoped (act on the active tab's selected index) ---
      case 'idx:edit':   requestIndexAction('startEditIndex'); return
      case 'idx:view':   requestIndexAction('openIndexDetails'); return
      case 'idx:copy':   requestIndexAction('copyIndex'); return
      case 'idx:drop':   requestIndexAction('openDropIndexConfirm'); return
      case 'idx:hide':   requestIndexAction('setIndexHidden', true); return
      case 'idx:unhide': requestIndexAction('setIndexHidden', false); return

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
      // Refresh reloads the active tab when it only reads; the native menu is disabled
      // otherwise, but on Linux the key arrives here regardless (see onGlobalKeydown).
      case 'view:refresh':
        if (canRefreshWorkspace(activeTab.value)) requestRefresh()
        else showToast('Nothing to refresh in this tab')
        return
      case 'view:refresh_all':
        return refreshAll()

      // Tab navigation/closing. Close Tab and Close Tab (No Prompt) behave the same
      // today — there is no unsaved-changes prompt to differ on yet.
      case 'view:next_tab':      cycleTab(1); return
      case 'view:prev_tab':      cycleTab(-1); return
      case 'view:zoom_in':       zoomIn(); return
      case 'view:zoom_out':      zoomOut(); return
      case 'view:zoom_reset':    resetZoom(); return
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
        requestDocAction(id)
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
        requestHistory()
        return
      }

      // PostgreSQL (#145) — the same handlers the table workspace's own
      // toolbar/context menu already call (PG_ACTIONS). Each asks pgMenuTarget for
      // the depth its gate required, so a sidebar selection deep enough for the
      // action wins over the active tab and a shallower one falls back to it. The
      // gates already guarantee one of the two qualifies, so a null target here
      // means it went away between the menu enabling and the click — rare enough
      // to no-op rather than toast.
      case 'pg:new_sql': {
        const target = pgMenuTarget('schema')
        if (target) openPostgresQuery({ connectionId: target.connectionId, connectionName: target.connectionName, database: target.database })
        return
      }
      case 'pg:create_table': {
        const target = pgMenuTarget('schema')
        if (target) openModal('pgCreateTable', target)
        return
      }
      case 'pg:search_schema': {
        const target = pgMenuTarget('schema')
        if (target) openPostgresSearch({ connectionId: target.connectionId, connectionName: target.connectionName, database: target.database, schema: target.schema })
        return
      }
      case 'pg:row_history': {
        const target = pgMenuTarget('table')
        if (target?.table) openModal('pgRowHistory', target)
        return
      }
      case 'pg:drop_table': {
        const target = pgMenuTarget('table')
        if (target?.table) openModal('pgDrop', target)
        return
      }
    }
    // Everything else that names a feature (directly, or through MENU_ALIASES) runs it
    // on the menu's target, at the level the feature itself declares.
    const action = MENU_ALIASES[id] ?? id
    if (knownActions.has(action)) menuNode(action)
  }

  // Route a Document-menu action to the active collection tab's ResultsPanel, which
  // owns the field/document editors. The Document gates already guarantee an active
  // collection tab with a selected row/field, so this only needs to signal the panel.
  function requestDocMenuAction(action) {
    const tab = tabs.value.find(t => t.id === activeTabId.value)
    if (!tab || tab.kind !== 'collection' || (tab.runtime.selectedRow ?? -1) < 0) {
      showToast('Select a document in the results first')
      return
    }
    requestDocAction(action)
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
    requestDocAction(action)
  }

  // The file actions act on the dialog's own selected file, so they're dispatched
  // straight to the open dialog (#258). Resolving a database for them would aim them
  // at whatever the active tab names — reopening the dialog elsewhere and losing the
  // picked file — and their Gate::GridfsFile already guarantees a dialog with a
  // selection is open.
  const GRIDFS_FILE_ACTIONS = ['gridfs:view_file', 'gridfs:rename', 'gridfs:meta', 'gridfs:save', 'gridfs:remove']

  // GridFS menu actions operate inside the GridFS modal on its selected file/bucket.
  // Ensure the modal is open for the resolved database (preserving any existing
  // selection when it's already showing that db), then signal the requested action.
  async function requestGridfsAction(action) {
    if (GRIDFS_FILE_ACTIONS.includes(action)) {
      if (!openModals.gridfs) return
      openModals.gridfs.menuRequest = { action: action, nonce: Date.now() }
      return
    }
    const target = menuTarget('database')
    if (!target || !target.connectionId || !target.dbName) {
      showToast('Open a database first')
      return
    }
    const open = openModals.gridfs
    const sameOpen = open
      && open.connectionId === target.connectionId
      && open.dbName === target.dbName
    if (!sameOpen) {
      openModal('gridfs', {
        connectionId: target.connectionId,
        connectionName: target.connectionName,
        dbName: target.dbName,
      })
    }
    await nextTick()
    openModals.gridfs.menuRequest = { action: action, nonce: Date.now() }
  }
  // Two ways an action arrives: the native menu emits the clicked item's id, and on
  // Linux — where WebKitGTK swallows native accelerators, so menu.rs attaches none —
  // the webview matches the keyboard against the user's bindings itself.
  const nativeMenuOwnsShortcuts = !/Linux/i.test(navigator.userAgent)
  // #146: macOS reserves Ctrl+Tab/Ctrl+Shift+Tab for Cocoa's key-view-loop
  // navigation, claimed earlier in the dispatch pipeline than any menu accelerator —
  // so the native menu item for these two never fires from the keyboard (clicking it
  // still works). The keystroke still reaches the webview as an ordinary keydown, so
  // catch just these two here. matchBinding still honors a user rebind of either id.
  const isMac = /Mac/i.test(navigator.userAgent)
  const TAB_NAV_IDS = new Set(['view:next_tab', 'view:prev_tab'])

  function onGlobalKeydown(e) {
    if (isEditingTarget(e.target)) return
    const id = matchBinding(e, keyBindings.value)
    if (id) {
      e.preventDefault()
      handleMenuAction(id)
    }
  }

  function onTabNavKeydown(e) {
    if (isEditingTarget(e.target)) return
    const id = matchBinding(e, keyBindings.value)
    if (id && TAB_NAV_IDS.has(id)) {
      e.preventDefault()
      handleMenuAction(id)
    }
  }

  let unlisten
  onMounted(() => {
    unlisten = onMenuAction(handleMenuAction)
    if (!nativeMenuOwnsShortcuts) window.addEventListener('keydown', onGlobalKeydown)
    else if (isMac) window.addEventListener('keydown', onTabNavKeydown)
  })
  onUnmounted(() => {
    unlisten.then(off => off())
    window.removeEventListener('keydown', onGlobalKeydown)
    window.removeEventListener('keydown', onTabNavKeydown)
  })

  return { handleMenuAction }
}
