// MongoDB query workspace definitions (Work 5C): find, aggregate, SQL-to-MQL, and
// shell. Each owns the full shape of its fresh tab — the legacy flat fields keep
// existing panes working unchanged; the canonical envelope comes from the factory.
// Work 6 adds the lifecycle hooks (duplicate, restore, dispose) that generic helpers
// dispatch through.
import { WORKSPACE_COMPONENTS } from '../../../workspaces/registry'
import { resourceFromFeatureNode, resourceFromLegacyTab } from '../../../utils/legacyResourceRef'
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

// The editor fields that survive a duplicate, replayed onto a fresh runtime spine.
// VQB/column-order arrive here as references; the generic helper deep-clones the
// whole fields object so no two tabs ever share them.
function editorState(workspace) {
  return {
    filter: workspace.filter ?? '', projection: workspace.projection ?? '',
    sort: workspace.sort ?? '', skip: workspace.skip ?? 0, limit: workspace.limit ?? 50,
    pipeline: workspace.pipeline ?? '', vqb: workspace.vqb ?? null,
    colOrder: workspace.colOrder ?? null, readOnly: !!workspace.readOnly,
  }
}

// Restore reconstructs the full spine from a projected saved record: the saved
// editor fields come back verbatim, runtime state starts fresh, and the canonical
// target is re-derived from the saved identity fields.
function restoreCollection(saved, defaults = {}) {
  const target = resourceFromFeatureNode(collectionTarget(saved))
  return {
    title: saved.title || saved.collectionName,
    target,
    fields: {
      ...collectionFields({ target, defaults }),
      mode: saved.mode || 'find',
      ...editorState(saved),
    },
  }
}

export const queryDefinitions = [
  {
    type: 'mongodb.find',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.collection,
    create(ctx) {
      return {
        title: ctx.target.collectionName,
        target: resourceFromFeatureNode(collectionTarget(ctx.target)),
        fields: { ...collectionFields(ctx), mode: 'find', pipeline: '' },
      }
    },
    duplicate(workspace) {
      // Find is the only restored/duplicated query that re-runs automatically, so
      // the marker rides along and the store's marker-driven activation handles it.
      return {
        title: workspace.title,
        target: resourceFromFeatureNode(collectionTarget(workspace)),
        fields: { ...collectionFields({ target: collectionTarget(workspace), defaults: {} }), mode: 'find', ...editorState(workspace), _restored: true },
      }
    },
    restore(saved, ctx) {
      // Find is the only query that auto-runs on restore; the one-shot marker tells
      // the store's bridge to re-run it exactly once on activation.
      const base = restoreCollection(saved, ctx.defaults)
      return { ...base, fields: { ...base.fields, _restored: true } }
    },
  },
  {
    type: 'mongodb.aggregate',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.collection,
    create(ctx) {
      return {
        title: ctx.target.collectionName,
        target: resourceFromFeatureNode(collectionTarget(ctx.target)),
        fields: { ...collectionFields(ctx), mode: 'aggregate', pipeline: '' },
      }
    },
    duplicate(workspace) {
      // Clone the pipeline and editor state, reset runtime, and do not run.
      return {
        title: workspace.title,
        target: resourceFromFeatureNode(collectionTarget(workspace)),
        fields: { ...collectionFields({ target: collectionTarget(workspace), defaults: {} }), mode: 'aggregate', ...editorState(workspace) },
      }
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
      return {
        title: 'SQL: ' + ctx.target.collectionName,
        target: resourceFromFeatureNode(collectionTarget(ctx.target)),
        fields: {
          ...collectionFields(ctx),
          mode: 'sql', pipeline: '',
          sql: 'SELECT *\nFROM ' + ctx.target.collectionName,
          sqlError: null,
        },
      }
    },
    duplicate(workspace) {
      // Clone the SQL text and settings but clear the translated find pieces — a
      // duplicated SQL tab must never run with a stale translation.
      return {
        title: workspace.title,
        target: resourceFromFeatureNode(collectionTarget(workspace)),
        fields: {
          ...collectionFields({ target: collectionTarget(workspace), defaults: {} }),
          mode: 'sql', pipeline: '',
          sql: workspace.sql ?? '', sqlError: null,
          readOnly: !!workspace.readOnly, colOrder: workspace.colOrder ?? null,
        },
      }
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
      return {
        title: 'mongosh: ' + ctx.target.dbName,
        target: resourceFromFeatureNode({
          connectionId: ctx.target.connectionId,
          connectionName: ctx.target.connectionName,
          dbName: ctx.target.dbName,
        }),
        fields: {
          kind: 'shell',
          connectionId: ctx.target.connectionId,
          connectionName: ctx.target.connectionName,
          dbName: ctx.target.dbName,
          // Each shell tab gets its own backend JS session so variables persist
          // across runs; the injected source keeps tests deterministic.
          sessionId: ctx.ids.session(),
          code: '', history: [], isRunning: false,
          results: [], resultView: 'table', resultTab: 'Console',
          runError: null, elapsedMs: null, drillPath: [], hasRun: false,
          selectedRow: -1, selectedRows: [],
          logs: [], scalar: undefined, hasScalar: false,
        },
      }
    },
    duplicate(workspace, ctx) {
      // Each shell tab owns its backend JS session, so a duplicate opens a fresh one;
      // the injected session source keeps tests deterministic.
      return {
        title: workspace.title,
        target: resourceFromFeatureNode({
          connectionId: workspace.connectionId,
          connectionName: workspace.connectionName,
          dbName: workspace.dbName,
        }),
        fields: {
          kind: 'shell',
          connectionId: workspace.connectionId,
          connectionName: workspace.connectionName,
          dbName: workspace.dbName,
          sessionId: ctx.ids.session(),
          code: workspace.code || '', scriptPath: workspace.scriptPath || null,
          history: [], isRunning: false,
          results: [], resultView: 'table', resultTab: 'Console',
          runError: null, elapsedMs: null, drillPath: [], hasRun: false,
          selectedRow: -1, selectedRows: [],
          logs: [], scalar: undefined, hasScalar: false,
        },
      }
    },
    restore(saved, ctx) {
      return {
        title: saved.title || 'mongosh: ' + saved.dbName,
        target: resourceFromFeatureNode({
          connectionId: saved.connectionId,
          connectionName: saved.connectionName,
          dbName: saved.dbName,
        }),
        fields: {
          kind: 'shell',
          connectionId: saved.connectionId,
          connectionName: saved.connectionName,
          dbName: saved.dbName,
          sessionId: ctx.ids.session(),
          code: saved.code || '', scriptPath: saved.scriptPath || null,
          history: [], isRunning: false,
          results: [], resultView: 'table', resultTab: 'Console',
          runError: null, elapsedMs: null, drillPath: [], hasRun: false,
          selectedRow: -1, selectedRows: [],
          logs: [], scalar: undefined, hasScalar: false,
        },
      }
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