// The generic workspace factory (Work 5A): the single place a fresh workspace of
// any type is assembled. The type's definition owns the engine-specific shape; this
// file owns the canonical envelope — id, type, engine, title, color, target — which
// definitions can never override, plus the ID policy every definition shares.
import { getWorkspaceDefinition } from './registry'

// crypto.randomUUID is present in every webview this app targets; the fallback only
// covers test environments that stub it away.
function defaultId() {
  return crypto.randomUUID ? crypto.randomUUID() : 'ws-' + Date.now() + '-' + Math.random().toString(36).slice(2)
}

export function createWorkspace(type, context = {}) {
  const def = getWorkspaceDefinition(type)
  const supplied = context.ids || {}
  const workspaceId = supplied.workspace ? supplied.workspace() : defaultId()
  const created = def.create({
    target: context.target ?? null,
    defaults: context.defaults ?? {},
    options: context.options ?? {},
    ids: {
      workspace: () => workspaceId,
      // Injected so tests get deterministic shell sessions; the fallback keeps the
      // old session-id behavior (workspace id when crypto is unavailable).
      session: supplied.session ? supplied.session : () => (crypto.randomUUID ? crypto.randomUUID() : workspaceId),
    },
  })
  return {
    ...created.fields,
    id: workspaceId,
    type: def.type,
    engine: def.engine,
    title: created.title,
    color: null,
    target: created.target ?? null,
  }
}