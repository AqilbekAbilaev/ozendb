// MongoDB tool workspace definitions (Work 5D): indexes, schema, search, import,
// export, and current operations. Same contract as the query definitions — fresh
// flat legacy fields, canonical envelope owned by the generic factory. Work 6 adds
// the duplicate/restore hooks: tool tabs clone their durable configuration (import
// sources, export mapping, ops settings) and reset their runtime previews/rows.
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

// Indexes/Schema/Search tabs are identity-only: the pane reloads its data on mount,
// so a duplicate is just the same target with a fresh id. Schema and Search stay
// non-persisted (no restore hook) — restoring them is Work 7's decision.
function identityTool(kind, titlePrefix) {
  return {
    duplicate(workspace) {
      return {
        title: workspace.title || titlePrefix + ' ' + (workspace.collName || workspace.dbName),
        target: resourceFromFeatureNode(shortTarget(workspace)),
        fields: { kind, ...shortTarget(workspace) },
      }
    },
    restore(saved) {
      return {
        title: saved.title || titlePrefix + ' ' + saved.collName,
        target: resourceFromFeatureNode(shortTarget(saved)),
        fields: { kind, ...shortTarget(saved) },
      }
    },
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
    ...identityTool('indexes', 'Index Manager:'),
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
    duplicate: identityTool('schema', 'Schema:').duplicate,
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
    duplicate: identityTool('search', 'Search:').duplicate,
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
    duplicate(workspace) {
      // The durable configuration (source + format options) is cloned; the preview
      // and the field mapping are re-derived from the source, so they start empty.
      if (workspace.format === 'csv') {
        return {
          title: workspace.title,
          target: resourceFromFeatureNode(shortTarget(workspace)),
          fields: {
            kind: 'import', ...shortTarget(workspace), format: 'csv',
            subTab: 'source', sourceType: workspace.sourceType || 'file',
            filePath: workspace.filePath || '',
            csv: {
              delimiter: workspace.csv?.delimiter ?? ',',
              other: workspace.csv?.other ?? '',
              qualifier: workspace.csv?.qualifier ?? '"',
              skipLines: workspace.csv?.skipLines ?? 0,
              hasHeader: workspace.csv?.hasHeader ?? true,
            },
            targetDb: workspace.targetDb, targetColl: workspace.targetColl,
            mode: workspace.mode || 'insert',
            fields: [],
          },
        }
      }
      return {
        title: workspace.title,
        target: resourceFromFeatureNode(shortTarget(workspace)),
        fields: {
          kind: 'import', ...shortTarget(workspace), format: 'json',
          validate: !!workspace.validate,
          sources: (workspace.sources || []).map(s => ({
            path: s.path, name: s.name,
            targetDb: s.targetDb, targetColl: s.targetColl, mode: s.mode,
          })),
          selectedSource: -1,
          previewOpen: false,
        },
      }
    },
    restore(saved, ctx) {
      // Restore re-derives preview state exactly like the current session service:
      // the CSV options come back with safe defaults, the JSON sources verbatim.
      if (saved.format === 'csv') {
        return {
          title: saved.title,
          target: resourceFromFeatureNode(shortTarget(saved)),
          fields: {
            kind: 'import', ...shortTarget(saved), format: 'csv',
            subTab: 'source',
            sourceType: saved.sourceType || 'file', filePath: saved.filePath || '',
            csv: {
              delimiter: saved.csv?.delimiter ?? ',', other: saved.csv?.other ?? '',
              qualifier: saved.csv?.qualifier ?? '"',
              skipLines: saved.csv?.skipLines ?? 0,
              hasHeader: saved.csv?.hasHeader ?? true,
            },
            targetDb: saved.targetDb, targetColl: saved.targetColl,
            mode: saved.mode || 'insert',
            fields: [],
          },
        }
      }
      const sources = (saved.sources || []).map(s => ({
        path: s.path, name: s.name,
        targetDb: s.targetDb, targetColl: s.targetColl, mode: s.mode,
      }))
      return {
        title: saved.title,
        target: resourceFromFeatureNode(shortTarget(saved)),
        fields: {
          kind: 'import', ...shortTarget(saved), format: 'json',
          validate: !!saved.validate,
          sources,
          selectedSource: sources.length ? 0 : -1,
          previewOpen: false,
        },
      }
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
    duplicate(workspace) {
      // The mapping and the frozen source/filter are the user's curation and must
      // survive; the result banner is runtime state and starts clear.
      return {
        title: workspace.title,
        target: resourceFromFeatureNode(shortTarget(workspace)),
        fields: {
          kind: 'export', ...shortTarget(workspace),
          step: workspace.step || 0, format: workspace.format || 'json',
          incremental: !!workspace.incremental,
          source: workspace.source || 'collection',
          sourceCount: workspace.sourceCount ?? null,
          filter: workspace.filter || '{}',
          fields: (workspace.fields || []).map(f => ({
            source: f.source, target: f.target, kind: f.kind, include: !!f.include,
          })),
          result: null,
        },
      }
    },
    restore(saved) {
      return {
        title: saved.title,
        target: resourceFromFeatureNode(shortTarget(saved)),
        fields: {
          kind: 'export', ...shortTarget(saved),
          step: saved.step || 0, format: saved.format || 'json',
          incremental: !!saved.incremental,
          source: saved.source || 'collection',
          sourceCount: saved.sourceCount ?? null,
          filter: saved.filter || '{}',
          fields: (saved.fields || []).map(f => ({
            source: f.source, target: f.target, kind: f.kind, include: !!f.include,
          })),
          result: null,
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
    duplicate(workspace) {
      // The toolbar settings (frequency, filters, view) define what the tab watches;
      // the operation rows and grid state are live server state and start fresh.
      return {
        title: workspace.title,
        target: resourceFromFeatureNode(shortTarget(workspace)),
        fields: {
          kind: 'currentOps', ...shortTarget(workspace),
          ...opsDefaults(),
          frequency: workspace.frequency ?? 2000,
          retention: workspace.retention ?? 10_000,
          ownOnly: !!workspace.ownOnly, showSys: !!workspace.showSys,
          slowOnly: !!workspace.slowOnly, slowSecs: workspace.slowSecs ?? 3,
          dbName: workspace.dbName || '', collName: workspace.collName || '',
          view: workspace.view || 'table',
        },
      }
    },
    restore(saved) {
      // Settings restore over fresh defaults; ops/rows stay empty and the pane
      // resumes polling on mount.
      return {
        title: saved.title,
        target: resourceFromFeatureNode(shortTarget(saved)),
        fields: {
          kind: 'currentOps', ...shortTarget(saved),
          ...opsDefaults(),
          frequency: saved.frequency ?? 2000,
          retention: saved.retention ?? 10_000,
          ownOnly: !!saved.ownOnly, showSys: !!saved.showSys,
          slowOnly: !!saved.slowOnly, slowSecs: saved.slowSecs ?? 3,
          dbName: saved.dbName || '', collName: saved.collName || '',
          view: saved.view || 'table',
        },
      }
    },
  },
]