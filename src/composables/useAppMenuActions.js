import { nextTick } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'
import { HELP_URLS, HELP_MODALS, isHelpLink } from '../constants/helpLinks'
import { tabs, activeTabId, closeTab, cycleTab } from '../stores/tabs'

export function useAppMenuActions({
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
}) {
  const appWindow = getCurrentWindow()

  function indexMenuAction(method, ...args) {
    const tab = tabs.value.find(t => t.id === activeTabId.value)
    if (tab && tab._idxApi && tab._idxApi[method]) tab._idxApi[method](...args)
  }

  // Routes menu-bar actions (emitted by id) to the same handlers the toolbar and
  // right-click menus already use. The menu bar never emits a disabled item.
  function handleMenuAction(id) {
    // Help items are tables, not switch arms: most open the project's GitHub, the rest
    // open an app-level modal (see constants/helpLinks).
    if (isHelpLink(id)) {
      openUrl(HELP_URLS[id]).catch(() => showToast('Could not open link'))
      return
    }
    if (HELP_MODALS[id]) { modalsApi.openModal(HELP_MODALS[id]); return }
    switch (id) {
      // --- direct modals / app ---
      case 'file:connect':     modalsApi.openModal('connectionManager'); return
      case 'file:exit':        appWindow.close(); return
      case 'edit:preferences': preferencesInitialTab.value = 'general'; modalsApi.openModal('preferences'); return
      case 'help:shortcuts':   preferencesInitialTab.value = 'keyboard'; modalsApi.openModal('preferences'); return
      case 'help:quickstart':  openQuickstart(); return
      case 'help:updates':     updater.checkNow(); return
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
        if (id === 'file:load') browserRequest.value = { nonce: Date.now() }
        else saveQueryRequest.value = { nonce: Date.now() }
        return
      }
      case 'file:search':       handleTool('search', menuTarget('database')); return
      case 'coll:open_tab':     handleTool('collection', menuTarget('collection')); return
      case 'coll:export':       handleTool('export', menuTarget('collection')); return
      case 'coll:import':       handleTool('import', menuTarget('collection')); return

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
  return { handleMenuAction }
}
