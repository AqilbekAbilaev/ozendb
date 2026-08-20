// Generic workspace lifecycle dispatch (Work 6): duplicate, restore, and dispose
// route through the registered definitions. The helpers own what every definition
// must share — fresh IDs, deep detachment of durable state, common metadata, and
// contained failure — so definitions never touch the workspace array directly.
import { getWorkspaceDefinition, workspaceTypeForSaved } from './registry'
import { sameResource, isResourceAncestor } from '../utils/resourceRef'

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

export function duplicateWorkspace(workspace, context = {}) {
  const def = getWorkspaceDefinition(workspace.type)
  if (!def.duplicate) return null
  const id = (context.ids && context.ids.workspace) ? context.ids.workspace() : defaultId()
  const result = def.duplicate(workspace, {
    ...context,
    ids: { workspace: () => id, session: idSource(context, id) },
  })
  if (result === null) return null
  return {
    ...deepClone(result.fields),
    id: id,
    type: def.type,
    engine: def.engine,
    title: result.title,
    color: workspace.color ?? null,
    target: result.target !== undefined ? deepClone(result.target) : null,
  }
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
  return {
    ...deepClone(result.fields),
    id: saved.id,
    type: def.type,
    engine: def.engine,
    title: result.title,
    color: saved.color ?? null,
    target: result.target !== undefined ? deepClone(result.target) : null,
  }
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

// Predicate for closeWhere: a workspace is affected by dropping `resource` when its
// target is the resource itself or anything under it. Containment, not equality —
// dropping a database also closes the collection-scoped tabs inside it, and a
// connection-scoped Current Operations tab survives a database drop.
export function affectedByResource(drop) {
  return (tab) => !!tab.target && (sameResource(tab.target, drop) || isResourceAncestor(drop, tab.target))
}