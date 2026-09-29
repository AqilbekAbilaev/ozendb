// Generic workspace lifecycle dispatch (Work 6): duplicate, restore, and dispose
// route through the registered definitions. The helpers own what every definition
// must share — fresh IDs, deep detachment of durable state, common metadata, and
// contained failure — so definitions never touch the workspace array directly.
import { getWorkspaceDefinition, workspaceTypeForSaved } from './registry'
import { createResourceRef, sameResource, isResourceAncestor } from '../utils/resourceRef'

function defaultId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'ws-' + Date.now() + '-' + Math.random().toString(36).slice(2)
}

// Durable tab fields (filters, mappings, column orders, VQB state) are plain JSON
// data, so a JSON round-trip would do; structuredClone is preferred where the
// runtime has it because it also preserves undefined values (shell scalar state).
// Tab objects arrive wrapped in Vue reactivity, which structuredClone cannot see
// through — the JSON fallback detaches them just as cleanly.
export function deepClone(value) {
  if (value === undefined) return undefined
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      return JSON.parse(JSON.stringify(value))
    }
  }
  return JSON.parse(JSON.stringify(value))
}

function idSource(context, workspaceId) {
  const ids = context.ids || {}
  return ids.session ? ids.session : () => (crypto.randomUUID ? crypto.randomUUID() : workspaceId)
}

// `deepClone` is a structural copy: it keeps data and drops everything else, which
// includes accessors a definition defines over its fields. A definition that needs
// something re-established on the copy says so with `hydrate(fields)`, called on the
// cloned fields before the envelope is put back on. Without it, a definition whose
// fields are more than plain data works when created and breaks when duplicated —
// which is exactly the kind of bug that only shows up two steps later.
function hydrated(def, fields) {
  const cloned = deepClone(fields)
  return def.hydrate ? def.hydrate(cloned) : cloned
}

export function duplicateWorkspace(workspace, context = {}) {
  const def = getWorkspaceDefinition(workspace.type)
  if (!def.duplicate) return null
  const id = (context.ids && context.ids.workspace) ? context.ids.workspace() : defaultId()
  const result = def.duplicate(workspace, {
    ...context,
    ids: { workspace: () => id, session: idSource(context, id) },
  })
  if (result === null) return null
  // The envelope is assigned onto the fields rather than spread with them: a spread
  // would build a new object and leave any accessor `hydrate` just re-established
  // behind, which is the bug this hook exists to prevent.
  return Object.assign(hydrated(def, result.fields), {
    id: id,
    type: def.type,
    engine: def.engine,
    title: result.title,
    color: workspace.color ?? null,
    target: result.target !== undefined ? deepClone(result.target) : null,
  })
}

// Restore reconstructs a fresh runtime workspace from a projected saved record.
// The saved id is preserved (that is what session persistence re-activates); the
// type comes from the saved kind/mode. Returns null for records of non-persisted
// kinds, so a stale file can never materialize a workspace the app no longer saves.
export function restoreWorkspace(saved, context = {}) {
  const type = workspaceTypeForSaved(saved)
  if (!type) return null
  const def = getWorkspaceDefinition(type)
  if (!def.restore) return null
  const result = def.restore(saved, {
    ...context,
    ids: { session: idSource(context, saved.id) },
  })
  if (!result) return null
  return Object.assign(hydrated(def, result.fields), {
    id: saved.id,
    type: def.type,
    engine: def.engine,
    title: result.title,
    color: saved.color ?? null,
    target: result.target !== undefined ? deepClone(result.target) : null,
  })
}

// Disposal is best-effort by contract: the caller fires it and forgets it, failures
// are swallowed, and a missing hook is a no-op — closing a tab must never depend on
// engine teardown succeeding.
export function disposeWorkspace(workspace) {
  const def = workspace && workspace.type ? getWorkspaceDefinition(workspace.type) : null
  if (!def || !def.dispose) return Promise.resolve()
  try {
    return Promise.resolve(def.dispose(workspace)).catch(() => {})
  } catch {
    return Promise.resolve()
  }
}

// Whether Refresh may reload this workspace: only a view that reads, never one whose
// re-run could change data. A definition opts in with `canRefresh(workspace)`.
export function canRefreshWorkspace(workspace) {
  if (!workspace?.type) return false
  return !!getWorkspaceDefinition(workspace.type).canRefresh?.(workspace)
}

// Predicate for closeWhere: a workspace is affected by dropping `resource` when its
// target is the resource itself or anything under it. Containment, not equality —
// dropping a database also closes the collection-scoped tabs inside it, and a
// connection-scoped Current Operations tab survives a database drop.
export function affectedByResource(drop) {
  return (tab) => !!tab.target && (sameResource(tab.target, drop) || isResourceAncestor(drop, tab.target))
}

// The mirror of affectedByResource: rewrite a workspace's target after its resource is
// renamed, containment included — renaming a database also retargets every collection
// workspace under it. Returns whether this workspace changed.
//
// Without this a rename moved the flat fields and left `target` on the old name, so
// affectedByResource stopped matching the tab and a later drop never closed it.
export function retargetResource(from, to) {
  return (workspace) => {
    const target = workspace.target
    if (!target) return false
    if (!sameResource(target, from) && !isResourceAncestor(from, target)) return false

    const segments = [...to.segments, ...target.segments.slice(from.segments.length)]
    workspace.target = createResourceRef(to.connectionId, segments)

    // Every workspace kind spells its identity the same way now, so the flat copies
    // are pushed forward from the new target rather than left to drift out of step.
    //
    // Deliberately does NOT touch `collName`: that key survives only on Current
    // Operations, where it is the user's collection *filter*, not identity — and a
    // connection-scoped tab is never matched by this predicate anyway.
    for (const segment of segments) {
      if (segment.kind === 'database' && workspace.dbName !== undefined) workspace.dbName = segment.name
      if (segment.kind === 'collection' && workspace.collectionName !== undefined) {
        workspace.collectionName = segment.name
      }
    }

    // A tab the user renamed by hand keeps its title; only a default one follows.
    const renamed = from.segments[from.segments.length - 1]
    if (renamed && workspace.title === renamed.name) {
      workspace.title = to.segments[to.segments.length - 1].name
    }
    return true
  }
}
