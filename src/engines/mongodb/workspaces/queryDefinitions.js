// MongoDB query workspace definitions (Work 5C): find, aggregate, SQL-to-MQL, and
// shell. Each owns the full shape of its fresh tab — the legacy flat fields keep
// existing panes working unchanged; the canonical envelope comes from the factory.
// Work 6 adds the lifecycle hooks (duplicate, restore, dispose) that generic helpers
// dispatch through.
import { WORKSPACE_COMPONENTS } from '../../../workspaces/registry'
import { resourceFromFeatureNode } from '../../../utils/legacyResourceRef'
import { closeShellSession } from '../api/shell'

// The editor+result spine shared by every collection-scoped query mode. Scalar
// defaults arrive from the creator; the fallbacks mirror the app's settings defaults
// so a definition used without a context still produces a sane tab.
function collectionFields({ target, defaults }) {
  return {
    kind: 'collection',
    connectionId: target.connectionId,
    connectionName: target.connectionName,
    dbName: target.dbName,
    collectionName: target.collectionName,
    filter: '', projection: '', sort: '', skip: 0, limit: defaults.queryLimit ?? 50,
    vqb: null,
    resultView: defaults.resultView ?? 'table',
    results: [], hasRun: false, isRunning: false, runError: null,
    selectedRow: -1, selectedRows: [], elapsedMs: null,
  }
}

function collectionTarget(target) {
  return {
    connectionId: target.connectionId,
    connectionName: target.connectionName,
    dbName: target.dbName,
    collectionName: target.collectionName,
  }
}

// Identity for a collection-scoped workspace, from whichever object carries the flat
// fields — a creation context's target, a live workspace, or a saved record.
const collectionRef = (source) => resourceFromFeatureNode(collectionTarget(source))

// A fresh tab in the given mode. Every collection query starts from the same spine
// and differs only in `mode` and a few mode-specific fields.
function createCollection(ctx, mode, extra = {}) {
  return {
    title: ctx.target.collectionName,
    target: collectionRef(ctx.target),
    fields: { ...collectionFields(ctx), mode: mode, pipeline: '', ...extra },
  }
}

// A duplicate replays durable state onto a *fresh* runtime spine — results,
// selection, errors and timings all start empty. Writing that per mode is how two
// tabs end up sharing one set of results, so it happens here instead.
function duplicateCollection(workspace, mode, durable) {
  return {
    title: workspace.title,
    target: collectionRef(workspace),
    fields: {
      ...collectionFields({ target: workspace, defaults: {} }),
      mode: mode,
      // Same base as createCollection: `pipeline` is not part of collectionFields, so
      // a mode whose durable state omits it still gets an empty one rather than
      // undefined. Find and aggregate overwrite it from editorState.
      pipeline: '',
      ...durable,
    },
  }
}

// The editor fields that survive a duplicate, replayed onto a fresh runtime spine.
// VQB/column-order arrive here as references; the generic helper deep-clones the
// whole fields object so no two tabs ever share them.
function editorState(workspace) {
  return {
    filter: workspace.filter ?? '', projection: workspace.projection ?? '',
    sort: workspace.sort ?? '', skip: workspace.skip ?? 0, limit: workspace.limit ?? 50,
    pipeline: workspace.pipeline ?? '', vqb: workspace.vqb ?? null,
    colOrder: workspace.colOrder ?? null, readOnly: !!workspace.readOnly,
    ...(workspace.resultView ? { resultView: workspace.resultView } : {}),
  }
}

// Restore reconstructs the full spine from a projected saved record: the saved
// editor fields come back verbatim, runtime state starts fresh, and the canonical
// target is re-derived from the saved identity fields. The flat identity names
// (connectionName/dbName/collectionName) ride along from the saved record — the
// canonical target carries no names, and panes still read the flat fields.
function restoreCollection(saved, defaults = {}) {
  const target = resourceFromFeatureNode(collectionTarget(saved))
  return {
    title: saved.title || saved.collectionName,
    target,
    fields: {
      ...collectionFields({ target, defaults }),
      connectionId: saved.connectionId,
      connectionName: saved.connectionName ?? null,
      dbName: saved.dbName ?? null,
      collectionName: saved.collectionName ?? null,
      mode: saved.mode || 'find',
      ...editorState(saved),
    },
  }
}

// A shell workspace is database-scoped, so its identity is the connection plus the
// database — never the collection a sibling tab happens to be on.
function shellTarget(source) {
  return {
    connectionId: source.connectionId,
    connectionName: source.connectionName,
    dbName: source.dbName,
  }
}

// The full shape of a shell tab. Create, duplicate and restore all produce exactly
// this — they differ only in the editor text they carry over — so the runtime spine
// is written once. Getting it wrong in one of three copies is how a duplicated tab
// ends up sharing its predecessor's results.
//
// `sessionId` is always freshly minted: each shell tab owns its own backend JS
// session so variables persist across runs within a tab and never leak between them.
function shellFields(source, sessionId, durable = {}) {
  return {
    kind: 'shell',
    ...shellTarget(source),
    sessionId: sessionId,
    code: durable.code ?? '',
    scriptPath: durable.scriptPath ?? null,
    history: [], isRunning: false,
    results: [], resultView: 'table', resultTab: 'Console',
    runError: null, elapsedMs: null, drillPath: [], hasRun: false,
    selectedRow: -1, selectedRows: [],
    logs: [], scalar: undefined, hasScalar: false,
  }
}

function shellWorkspace(source, ctx, durable) {
  return {
    title: source.title || 'mongosh: ' + source.dbName,
    target: resourceFromFeatureNode(shellTarget(source)),
    fields: shellFields(source, ctx.ids.session(), durable),
  }
}

export const queryDefinitions = [
  {
    type: 'mongodb.find',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.collection,
    create(ctx) {
      return createCollection(ctx, 'find')
    },
    // Work 7: the durable editor state, projected from either a legacy record or a
    // live tab. Runtime fields (results, selection, errors) are never serialized.
    serialize(workspace) {
      return editorState(workspace)
    },
    duplicate(workspace) {
      // Find is the only restored/duplicated query that re-runs automatically, so
      // the active Mongo collection workspace consumes this one-shot marker.
      return duplicateCollection(workspace, 'find', { ...editorState(workspace), needsInitialRun: true })
    },
    restore(saved, ctx) {
      // Find is the only query that auto-runs on restore; the one-shot marker tells
      // its workspace to run it exactly once on activation.
      const base = restoreCollection(saved, ctx.defaults)
      return { ...base, fields: { ...base.fields, needsInitialRun: true } }
    },
  },
  {
    type: 'mongodb.aggregate',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.collection,
    create(ctx) {
      return createCollection(ctx, 'aggregate')
    },
    serialize: editorState,
    duplicate(workspace) {
      // Clone the pipeline and editor state, reset runtime, and do not run.
      return duplicateCollection(workspace, 'aggregate', editorState(workspace))
    },
    restore(saved, ctx) {
      return restoreCollection(saved, ctx.defaults)
    },
  },
  {
    type: 'mongodb.sql_to_mql',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.collection,
    create(ctx) {
      const base = createCollection(ctx, 'sql', {
        sql: 'SELECT *\nFROM ' + ctx.target.collectionName,
        sqlError: null,
      })
      return { ...base, title: 'SQL: ' + ctx.target.collectionName }
    },
    serialize(workspace) {
      // SQL's translated find pieces are derived state, never stored; only the text
      // and the display settings come back.
      return {
        sql: workspace.sql ?? '', readOnly: !!workspace.readOnly,
        colOrder: workspace.colOrder ?? null,
      }
    },
    duplicate(workspace) {
      // Clone the SQL text and settings but clear the translated find pieces — a
      // duplicated SQL tab must never run with a stale translation.
      return duplicateCollection(workspace, 'sql', {
        sql: workspace.sql ?? '', sqlError: null,
        readOnly: !!workspace.readOnly, colOrder: workspace.colOrder ?? null,
      })
    },
    restore(saved, ctx) {
      // The translated find pieces are re-derived on the next Run, so they restore
      // empty (like a freshly opened SQL tab); only the SQL text itself comes back.
      const base = restoreCollection(saved, ctx.defaults)
      return {
        ...base,
        fields: {
          ...base.fields, mode: 'sql',
          sql: saved.sql ?? '', sqlError: null,
          filter: '', projection: '', sort: '', skip: 0, limit: 50, pipeline: '', vqb: null,
        },
      }
    },
  },
  {
    type: 'mongodb.shell',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.shell,
    create(ctx) {
      return shellWorkspace(ctx.target, ctx)
    },
    serialize(workspace) {
      // The session is backend state keyed by id; only the editor text is durable.
      return { code: workspace.code ?? '', scriptPath: workspace.scriptPath ?? null }
    },
    duplicate(workspace, ctx) {
      return shellWorkspace(workspace, ctx, workspace)
    },
    restore(saved, ctx) {
      return shellWorkspace(saved, ctx, saved)
    },
    dispose(workspace) {
      // Best-effort: closeShellSession resolves/rejects by itself, and the generic
      // helper contains any rejection so a failed teardown never blocks closure.
      // A shell that never opened a session has nothing to tear down.
      if (!workspace.sessionId) return Promise.resolve()
      return closeShellSession(workspace.sessionId)
    },
  },
]
