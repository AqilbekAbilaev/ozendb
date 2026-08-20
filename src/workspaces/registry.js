// Static component-only workspace registry (Work 4). It maps the current tab
// compatibility keys to components; resolution rules keep the pre-registry
// pane-dispatch behavior. This file is deliberately component-only: create,
// duplicate, serialize, restore, and dispose metadata arrive in Works 5 and 6.
import { defineAsyncComponent } from 'vue'
import QuickstartPane from '../components/panes/QuickstartPane.vue'
import MongoCollectionWorkspace from '../engines/mongodb/workspaces/collection/MongoCollectionWorkspace.vue'
import IndexManagerPane from '../components/panes/IndexManagerPane.vue'
import SchemaPane from '../components/panes/SchemaPane.vue'
import SearchPane from '../components/panes/SearchPane.vue'
import CurrentOpsPane from '../components/panes/CurrentOpsPane.vue'
import ImportPane from '../components/panes/ImportPane.vue'
import CsvImportPane from '../components/panes/CsvImportPane.vue'
import ExportPane from '../components/panes/ExportPane.vue'

// Lazy-loaded so CodeMirror (a large dep) is only fetched when a shell tab opens.
// Declared once at module scope so repeated resolution returns the same identity.
const ShellConsole = defineAsyncComponent(() => import('../components/app/ShellConsole.vue'))

export const WORKSPACE_COMPONENTS = Object.freeze({
  quickstart: QuickstartPane,
  collection: MongoCollectionWorkspace,
  shell: ShellConsole,
  indexes: IndexManagerPane,
  schema: SchemaPane,
  search: SearchPane,
  currentOps: CurrentOpsPane,
  export: ExportPane,
  import: ImportPane,
  'import:csv': CsvImportPane,
})

// Compatibility resolution only. A missing active tab resolves to Quickstart (as
// the old `!activeTab` branch did); unknown non-null kinds resolve to null so the
// blank-pane behavior is preserved.
export function workspaceComponentFor(tab) {
  if (!tab || tab.kind === 'quickstart') return WORKSPACE_COMPONENTS.quickstart
  if (tab.kind === 'import') {
    return tab.format === 'csv' ? WORKSPACE_COMPONENTS['import:csv'] : WORKSPACE_COMPONENTS.import
  }
  return WORKSPACE_COMPONENTS[tab.kind] || null
}

// Definition registry (Work 5). Populated once at startup by registerDefinitions();
// a duplicate type throws, so a definition file can never silently shadow another.
// Definitions are kept separate from components on purpose: registerDefinitions
// aggregates them, and nothing here imports a definition file — that would make the
// startup registration order depend on import order.
const definitions = new Map()

export function registerWorkspaceDefinition(def) {
  if (definitions.has(def.type)) {
    throw new Error(`Duplicate workspace type: ${def.type}`)
  }
  definitions.set(def.type, def)
}

export function getWorkspaceDefinition(type) {
  const def = definitions.get(type)
  if (!def) throw new Error(`Unknown workspace type: ${type}`)
  return def
}