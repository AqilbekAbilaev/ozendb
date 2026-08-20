// MongoDB query workspace definitions (Work 5C): find, aggregate, SQL-to-MQL, and
// shell. Each owns the full shape of its fresh tab — the legacy flat fields keep
// existing panes working unchanged; the canonical envelope comes from the factory.
import { WORKSPACE_COMPONENTS } from '../../../workspaces/registry'
import { resourceFromFeatureNode } from '../../../utils/legacyResourceRef'

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
  },
]