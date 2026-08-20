// MongoDB tool workspace definitions (Work 5D): indexes, schema, search, import,
// export, and current operations. Same contract as the query definitions — fresh
// flat legacy fields, canonical envelope owned by the generic factory.
import { WORKSPACE_COMPONENTS } from '../../../workspaces/registry'
import { resourceFromFeatureNode } from '../../../utils/legacyResourceRef'
import { opsDefaults } from '../../../composables/useCurrentOps'

function shortTarget(node) {
  return {
    connId: node.connId,
    connName: node.connName,
    dbName: node.dbName,
    collName: node.collName,
  }
}

export const toolDefinitions = [
  {
    type: 'mongodb.indexes',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.indexes,
    create(ctx) {
      return {
        title: 'Index Manager: ' + ctx.target.collName,
        target: resourceFromFeatureNode(shortTarget(ctx.target)),
        fields: { kind: 'indexes', ...shortTarget(ctx.target) },
      }
    },
  },
  {
    type: 'mongodb.schema',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.schema,
    create(ctx) {
      return {
        title: 'Schema: ' + ctx.target.collName,
        target: resourceFromFeatureNode(shortTarget(ctx.target)),
        fields: { kind: 'schema', ...shortTarget(ctx.target) },
      }
    },
  },
  {
    type: 'mongodb.search',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.search,
    create(ctx) {
      return {
        title: 'Search: ' + ctx.target.dbName,
        target: resourceFromFeatureNode(shortTarget(ctx.target)),
        fields: {
          kind: 'search',
          connId: ctx.target.connId,
          connName: ctx.target.connName,
          dbName: ctx.target.dbName,
        },
      }
    },
  },
  {
    type: 'mongodb.import',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.import,
    create(ctx) {
      const target = shortTarget(ctx.target)
      const format = ctx.options.format || 'json'
      const base = { kind: 'import', ...target, format }
      // CSV is single-source with Source/Target sub-tabs and per-file options; JSON
      // is a multi-source table. Two shapes of one tab, not two workspace types.
      const fields = format === 'csv'
        ? {
            ...base,
            subTab: 'source',           // 'source' | 'target'
            sourceType: 'file',         // 'clipboard' | 'file'
            filePath: '',
            csv: { delimiter: ',', other: '', qualifier: '"', skipLines: 0, hasHeader: true },
            targetDb: ctx.target.dbName, targetColl: ctx.target.collName, mode: 'insert',
            fields: [],                 // column → field mapping (Target options)
          }
        : {
            ...base,
            validate: false,
            sources: [],                // { path, name, targetDb, targetColl, mode }
            selectedSource: -1,
            previewOpen: false,
          }
      return { title: 'Import: ' + ctx.target.collName, target: resourceFromFeatureNode(target), fields }
    },
  },
  {
    type: 'mongodb.export',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.export,
    create(ctx) {
      const target = shortTarget(ctx.target)
      const source = ctx.options.source || 'collection'
      // The source fixes what gets exported and is frozen onto the tab at open time:
      // a later re-run re-reads the collection, but through the query as it was when
      // the export was set up, not whatever another tab shows now. The title carries
      // the source so two exports of one collection stay tellable apart.
      const filter = source === 'query'
        ? (ctx.target.query || '{}')
        : source === 'selected'
          ? JSON.stringify({ _id: { $in: ctx.target.selectedIds || [] } })
          : '{}'
      const suffix = source === 'query' ? ' (query)'
        : source === 'selected' ? ` (${(ctx.target.selectedIds || []).length} selected)`
        : ''
      return {
        title: 'Export: ' + ctx.target.collName + suffix,
        target: resourceFromFeatureNode(target),
        fields: {
          kind: 'export',
          ...target,
          step: 0, format: ctx.options.format || 'json', incremental: false,
          source,
          sourceCount: source === 'selected' ? (ctx.target.selectedIds || []).length : null,
          filter,
          fields: [],          // [{ source, target, kind, include }] — the user's mapping
          result: null,        // { count, path } after a successful export
        },
      }
    },
  },
  {
    type: 'mongodb.current_operations',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.currentOps,
    create(ctx) {
      return {
        title: 'Current Operations: ' + ctx.target.connName,
        target: resourceFromFeatureNode(shortTarget(ctx.target)),
        fields: {
          kind: 'currentOps',
          connId: ctx.target.connId,
          connName: ctx.target.connName,
          // Toolbar settings and grid state live on the tab so they survive tab
          // switches (the pane unmounts while another tab is active). opsDefaults is
          // a factory: the arrays and column order are per-tab, never shared.
          ...opsDefaults(),
        },
      }
    },
  },
]