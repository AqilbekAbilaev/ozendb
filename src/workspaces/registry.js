// The workspace registry: every definition by type, and the panes the app-level and
// MongoDB definitions render. A tab renders its type's component and nothing else.
import { defineAsyncComponent } from 'vue'
import QuickstartPane from '../components/panes/QuickstartPane.vue'

// Everything but Quickstart is fetched the first time a tab of its kind opens: the
// collection, shell and Current Operations panes carry CodeMirror, which would
// otherwise be parsed on every launch (src/startupImports.test.js holds that line).
// Declared once at module scope so repeated resolution returns the same identity.
const MongoCollectionWorkspace = defineAsyncComponent(() => import('../engines/mongodb/workspaces/collection/MongoCollectionWorkspace.vue'))
const ShellConsole = defineAsyncComponent(() => import('../components/app/ShellConsole.vue'))
const IndexManagerPane = defineAsyncComponent(() => import('../components/panes/IndexManagerPane.vue'))
const SchemaPane = defineAsyncComponent(() => import('../components/panes/SchemaPane.vue'))
const SearchPane = defineAsyncComponent(() => import('../components/panes/SearchPane.vue'))
const CurrentOpsPane = defineAsyncComponent(() => import('../components/panes/CurrentOpsPane.vue'))
const ImportPane = defineAsyncComponent(() => import('../components/panes/ImportPane.vue'))
const CsvImportPane = defineAsyncComponent(() => import('../components/panes/CsvImportPane.vue'))
const ExportPane = defineAsyncComponent(() => import('../components/panes/ExportPane.vue'))

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

// A tab's component comes from its type's definition: `componentFor(tab)` when the
// definition picks between components (import's JSON and CSV panes), `component`
// otherwise. No active tab shows Quickstart; an unknown type resolves to null, the
// blank pane.
export function workspaceComponentFor(tab) {
  if (!tab) return WORKSPACE_COMPONENTS.quickstart
  const def = definitions.get(tab.type)
  if (!def) return null
  return def.componentFor ? def.componentFor(tab) : def.component
}

// Definition registry. Populated once at startup by registerDefinitions();
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

// The unversioned persisted session records tabs by legacy kind/mode. Maps a saved
// record to its workspace type; null for kinds that are never persisted (quickstart)
// or unreadable shapes. Unknown collection modes must never
// silently become find workspaces, so they map to null and the migration skips
// them with a warning.
export function workspaceTypeForSaved(saved) {
  if (!saved || typeof saved !== 'object') return null
  switch (saved.kind) {
    case 'collection': {
      if (saved.mode === 'sql') return 'mongodb.sql_to_mql'
      if (saved.mode === 'aggregate') return 'mongodb.aggregate'
      if (!saved.mode || saved.mode === 'find') return 'mongodb.find'
      return null
    }
    case 'shell':    return 'mongodb.shell'
    case 'import':   return 'mongodb.import'
    case 'export':   return 'mongodb.export'
    case 'indexes':  return 'mongodb.indexes'
    case 'schema':   return 'mongodb.schema'
    case 'search':   return 'mongodb.search'
    case 'currentOps': return 'mongodb.current_operations'
    case 'pgTable':  return 'postgresql.table_browse'
    case 'pgQuery':  return 'postgresql.query'
    default:         return null
  }
}