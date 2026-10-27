// MongoDB's switches for the native menu (menu.rs's MongoDB gates), merged into the
// shared context by deriveMenuContext (utils/menuContext.js).
import { DEPTH, depth, mongoResource } from '../../utils/menuContext.js'
import { selectedIndex } from '../../stores/indexes.js'
import { workspaceIsCollection } from '../../workspaces/registry.js'
import { selectedGridfsFile } from './tools/gridfsSelection.js'

function tabDepth(tab) {
  return depth(mongoResource(tab, tab?.target ?? null))
}

function selectionDepth(treeSelection) {
  return depth(mongoResource(treeSelection, treeSelection?.resource))
}

// The dialog selections and whether the tab is a collection tab are read here rather
// than passed in, so the shared code never learns which state only MongoDB gates on.
function switches({ activeTab, treeSelection }) {
  const tab = activeTab || null
  const reaches = (level) => tabDepth(tab) >= DEPTH[level] || selectionDepth(treeSelection) >= DEPTH[level]

  // Document/field selection is a property of the ACTIVE collection tab's results
  // view only — never the sidebar. The Document menu acts on the row/field the user
  // has selected in the grid, which only exists while a collection tab is active and
  // has run a query. A field selection implies a row selection.
  const isCollection = workspaceIsCollection(tab)
  const rowCount = isCollection ? (tab.runtime.results?.length ?? 0) : 0
  const selectedRow = isCollection ? (tab.runtime.selectedRow ?? -1) : -1
  const hasDocument = selectedRow >= 0 && selectedRow < rowCount

  return {
    hasConnection: reaches('connection'),
    hasDatabase: reaches('database'),
    hasCollection: reaches('collection'),
    hasDocument: hasDocument,
    hasField: hasDocument && !!(tab && tab.runtime.selectedField),
    // Index-menu actions operate on the index selected in the Indexes dialog, which
    // is independent of the tab/tree selection.
    hasIndex: !!selectedIndex.value,
    // Same for the GridFS dialog's selected file (see Gate::GridfsFile).
    hasGridfsFile: !!selectedGridfsFile.value,
  }
}

export const mongoMenu = Object.freeze({
  switches: switches,
  // Any MongoDB row in the sidebar enables at least the Connection menu.
  selectionEnables: (treeSelection) => selectionDepth(treeSelection) >= 0,
  // An active MongoDB tab counts as an open connection for Refresh All Connections.
  tabNamesConnection: (tab) => tabDepth(tab) >= 0,
})
