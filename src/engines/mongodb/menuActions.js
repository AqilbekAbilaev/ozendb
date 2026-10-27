// MongoDB's native-menu items, which composables/useAppMenuActions hands over by id
// (through engines/contextActions.js), and the node they act on.
import { nextTick } from 'vue'
import { showToast } from '../../stores/toast'
import { activeTab } from '../../stores/tabs'
import { treeSelection } from '../../stores/connectionNavigation'
import { openModal, openModals } from '../../stores/modals'
import {
  requestHistory, requestSaveQuery, requestSavedQueryBrowser, requestDocAction, requestIndexAction, requestGridfsAction,
} from '../../stores/menuRequests'
import { resourceAt, sameResource } from '../../utils/resourceRef'
import { workspaceIsCollection } from '../../workspaces/registry'
import { openCollectionTab } from './tabs'
import { runMongoTool } from './toolbarActions'
import { resolveMenuTarget } from './menu'
import { vqbOpen } from './query/visualQueryBuilder'

/** The node a MongoDB menu item acts on: the sidebar selection or the active tab, whichever reaches `level`. */
export function mongoMenuTarget(level = null) {
  return resolveMenuTarget(activeTab.value, treeSelection.value, level)
}

// Menu items that run a toolbar tool (toolbarActions.js) on the node resolved at the
// tool's level.
const MENU_TOOLS = {
  'file:intellishell': { tool: 'shell',      level: 'database' },
  'file:sql':          { tool: 'sql',        level: 'collection' },
  'file:search':       { tool: 'search',     level: 'database' },
  'coll:open_tab':     { tool: 'collection', level: 'collection' },
  'coll:export':       { tool: 'export',     level: 'collection' },
  'coll:import':       { tool: 'import',     level: 'collection' },
}

const INDEX_ACTIONS = {
  'idx:edit':   ['startEditIndex'],
  'idx:view':   ['openIndexDetails'],
  'idx:copy':   ['copyIndex'],
  'idx:drop':   ['openDropIndexConfirm'],
  'idx:hide':   ['setIndexHidden', true],
  'idx:unhide': ['setIndexHidden', false],
}

// Act on the open GridFS dialog: its picked file, or the bucket (Gate::GridfsFile).
const GRIDFS_FILE_ACTIONS = ['gridfs:view_file', 'gridfs:rename', 'gridfs:meta', 'gridfs:save', 'gridfs:remove']
const GRIDFS_BUCKET_ACTIONS = ['gridfs:add', 'gridfs:copy_bucket', 'gridfs:drop_bucket']

// Open/activate a collection tab, then run in its results view.
const COLLECTION_DOC_ACTIONS = ['coll:insert_document', 'coll:update_dialog', 'coll:delete_dialog', 'coll:clear', 'edit:paste_documents']

// Act on the selected row/field in the active results view.
const DOCUMENT_ACTIONS = [
  'edit:copy', 'edit:copy_value', 'edit:copy_field', 'edit:copy_field_path', 'edit:copy_document',
  'doc:edit_value', 'doc:add_field', 'doc:remove_field', 'doc:rename_field', 'doc:view_json', 'doc:edit_json', 'doc:delete',
]

// Results view mode + Refresh Document act on the active collection tab's ResultsPanel;
// signal it directly (no row selection required).
const RESULTS_VIEW_ACTIONS = [
  'view:tree', 'view:table', 'view:json', 'view:refresh_document', 'view:step_column', 'view:step_cell', 'view:step_out',
]

// File → Load / Save and View → History Manager live in the active collection tab's
// QueryBar; signal it (no-op with a toast otherwise).
const QUERY_BAR_ACTIONS = {
  'file:load': requestSavedQueryBrowser,
  'file:save': requestSaveQuery,
  'view:history': requestHistory,
}

/**
 * Runs MongoDB's menu item `id`; false for an id that isn't MongoDB's. `runFeature` is
 * the shared dispatcher, which the tools hand their aliased actions to.
 */
export function runMongoMenuAction(id, { runFeature }) {
  if (id === 'coll:vqb') {
    showVisualQueryBuilder()
  } else if (MENU_TOOLS[id]) {
    runMongoTool(MENU_TOOLS[id].tool, mongoMenuTarget(MENU_TOOLS[id].level), runFeature)
  } else if (INDEX_ACTIONS[id]) {
    // Act on the index selected in the Index Manager.
    requestIndexAction(...INDEX_ACTIONS[id])
  } else if (GRIDFS_FILE_ACTIONS.includes(id) || GRIDFS_BUCKET_ACTIONS.includes(id)) {
    requestGridfsMenuAction(id)
  } else if (COLLECTION_DOC_ACTIONS.includes(id)) {
    requestCollectionDocAction(id)
  } else if (DOCUMENT_ACTIONS.includes(id)) {
    requestDocMenuAction(id)
  } else if (RESULTS_VIEW_ACTIONS.includes(id) || QUERY_BAR_ACTIONS[id]) {
    if (!workspaceIsCollection(activeTab.value)) showToast('Open a collection tab first')
    else if (QUERY_BAR_ACTIONS[id]) QUERY_BAR_ACTIONS[id]()
    else requestDocAction(id)
  } else {
    return false
  }
  return true
}

function showVisualQueryBuilder() {
  const target = mongoMenuTarget('collection')
  const collection = resourceAt(target?.resource, 'collection')
  if (!collection) {
    showToast('Open a collection first')
    return
  }
  openCollectionTab({ resource: collection, connectionName: target.connectionName })
  vqbOpen.value = true
}

// Route a Document-menu action to the active collection tab's ResultsPanel, which
// owns the field/document editors. The Document gates already guarantee an active
// collection tab with a selected row/field, so this only needs to signal the panel.
function requestDocMenuAction(action) {
  const tab = activeTab.value
  if (!workspaceIsCollection(tab) || (tab.runtime.selectedRow ?? -1) < 0) {
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
  const target = mongoMenuTarget('collection')
  const collection = resourceAt(target?.resource, 'collection')
  if (!collection) {
    showToast('Open a collection first')
    return
  }
  const active = activeTab.value
  const sameCollectionActive = workspaceIsCollection(active)
    && sameResource(active.target, collection)
  // Reuse the active tab when it already shows this collection; otherwise open one so
  // the operation has a results view to refresh afterward.
  if (!sameCollectionActive) {
    openCollectionTab({ resource: collection, connectionName: target.connectionName })
  }
  await nextTick()
  requestDocAction(action)
}

// GridFS menu actions operate inside the GridFS modal. File actions go straight to the
// open dialog, since resolving a database would lose the picked file (Gate::GridfsFile).
// Bucket actions open the modal on the resolved database (keeping its selection when
// it already shows that db), then signal the requested action.
//
// #288: the request travels through stores/menuRequests, never through the modal's
// payload — AppModals keys each dialog on its payload, so writing the action in there
// remounted the dialog and threw away the very file selection the action needed.
async function requestGridfsMenuAction(action) {
  if (GRIDFS_FILE_ACTIONS.includes(action)) {
    if (!openModals.gridfs) return
    requestGridfsAction(action)
    return
  }
  const target = mongoMenuTarget('database')
  // A collection resolves too; GridFS acts on its database.
  const database = resourceAt(target?.resource, 'database')
  if (!database) {
    showToast('Open a database first')
    return
  }
  if (!sameResource(openModals.gridfs?.resource, database)) {
    openModal('gridfs', { resource: database, connectionName: target.connectionName })
  }
  // Let the open/remount settle first: opening the dialog on another database replaces
  // the one on screen, and the request belongs to the new instance, not the old one.
  await nextTick()
  requestGridfsAction(action)
}
