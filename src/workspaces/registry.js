// The workspace registry: definitions by type, and the generic dispatch every host
// (WorkspaceArea.vue) reads through instead of knowing which engine owns which pane.

// A tab's component comes from its type's definition: `componentFor(tab)` when the
// definition picks between components (import's JSON and CSV panes), `component`
// otherwise. With no active tab, the app.quickstart definition's own component is the
// fallback — there is normally always a Quickstart tab, but an empty activeTabId (a
// test, or a session mid-restore) can still ask for one before a match exists. An
// unknown type resolves to null, the blank pane.
export function workspaceComponentFor(tab) {
  if (!tab) return definitions.get('app.quickstart')?.component ?? null
  const def = definitions.get(tab.type)
  if (!def) return null
  return def.componentFor ? def.componentFor(tab) : def.component
}

// Most panes take just `{ activeTab }` and emit nothing WorkspaceArea.vue needs to
// route — that's the `null` default. A definition can mark a different UI contract on
// itself (`paneKind`) when its pane needs more: 'quickstart' (no props at all) or
// 'collection' (the full compatibility surface plus the query/result listeners). This
// is how the host asks a definition what it needs instead of comparing resolved
// component identity, which would force it to import the engine's own components.
export function workspacePaneKind(tab) {
  if (!tab) return 'quickstart'
  return definitions.get(tab.type)?.paneKind ?? null
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
