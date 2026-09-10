// MongoDB tool workspace definitions (Work 5D): indexes, schema, search, import,
// export, and current operations. Same contract as the query definitions — fresh
// flat legacy fields, canonical envelope owned by the generic factory. Work 6 adds
// the duplicate/restore hooks: tool tabs clone their durable configuration (import
// sources, export mapping, ops settings) and reset their runtime previews/rows.
import { WORKSPACE_COMPONENTS } from '../../../workspaces/registry'
import { resourceFromFeatureNode } from '../../../utils/legacyResourceRef'
import { opsDefaults } from '../../../composables/useCurrentOps'

// A tool workspace's identity fields, in the same long spelling collection and shell
// workspaces use — so a pane reading `activeTab.collectionName` does not have to know
// which kind of tab it is looking at.
//
// Reads either spelling because its callers differ: `create` is handed a feature node
// (still short — see audit §8), while `duplicate` and `restore` are handed a workspace
// or saved record, which are long.
function toolTarget(source) {
  return {
    connectionId: source.connectionId ?? source.connId ?? null,
    connectionName: source.connectionName ?? source.connName ?? null,
    dbName: source.dbName ?? null,
    collectionName: source.collectionName ?? source.collName ?? null,
  }
}

// Current Operations is connection-scoped: dbName/collName on the tab are *filters*,
// not identity, so duplicate/restore must not read them into the target (a
// collection-scoped target would also close the tab when its database drops).
function connectionScope(node) {
  return { connId: node.connId ?? node.connectionId, connName: node.connName ?? node.connectionName }
}

// Identity for a connection-scoped tool. Deliberately not toolTarget: Current
// Operations carries dbName/collName as *filters*, and spreading collection-level
// identity over them would overwrite what the user is filtering on.
function toolConnectionTarget(source) {
  return {
    connectionId: source.connectionId ?? source.connId ?? null,
    connectionName: source.connectionName ?? source.connName ?? null,
  }
}

function opsTarget(node) {
  return resourceFromFeatureNode(connectionScope(node))
}

// Indexes/Schema/Search tabs are identity-only: the pane reloads its data on mount,
// so a duplicate is just the same target with a fresh id. Work 7 makes Schema and
// Search persist (identity only, like Indexes) — the restore hook is shared too.
function identityTool(kind, titlePrefix, anchor = (source) => source.collectionName || source.dbName) {
  const rebuild = (source) => ({
    title: source.title || titlePrefix + ' ' + anchor(source),
    target: resourceFromFeatureNode(toolTarget(source)),
    fields: { kind, ...toolTarget(source) },
  })
  return { duplicate: rebuild, restore: rebuild }
}

export const toolDefinitions = [
  {
    type: 'mongodb.indexes',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.indexes,
    create(ctx) {
      return {
        title: 'Index Manager: ' + ctx.target.collName,
        target: resourceFromFeatureNode(toolTarget(ctx.target)),
        fields: { kind: 'indexes', ...toolTarget(ctx.target) },
      }
    },
    serialize: () => ({}),
    ...identityTool('indexes', 'Index Manager:'),
  },
  {
    type: 'mongodb.schema',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.schema,
    create(ctx) {
      return {
        title: 'Schema: ' + ctx.target.collName,
        target: resourceFromFeatureNode(toolTarget(ctx.target)),
        fields: { kind: 'schema', ...toolTarget(ctx.target) },
      }
    },
    serialize: () => ({}),
    ...identityTool('schema', 'Schema:'),
  },
  {
    type: 'mongodb.search',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.search,
    create(ctx) {
      return {
        title: 'Search: ' + ctx.target.dbName,
        target: resourceFromFeatureNode(toolTarget(ctx.target)),
        fields: {
          kind: 'search',
          ...toolConnectionTarget(ctx.target),
          dbName: ctx.target.dbName,
        },
      }
    },
    serialize: () => ({}),
    // Search is database-scoped, so its title falls back to dbName rather than the
    // collName the shared helper reaches for.
    ...identityTool('search', 'Search:', (saved) => saved.dbName),
  },
  {
    type: 'mongodb.import',
    engine: 'mongodb',
    component: WORKSPACE_COMPONENTS.import,
    create(ctx) {
      const target = toolTarget(ctx.target)
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
    serialize(workspace) {
      // The durable configuration mirrors what restore accepts: CSV options with
      // defaults, JSON sources projected down to their four durable fields. Preview
      // rows and the field mapping are re-derived on mount, never stored.
      if (workspace.format === 'csv') {
        return {
          format: 'csv',
          sourceType: workspace.sourceType ?? 'file', filePath: workspace.filePath ?? '',
          csv: {
            delimiter: workspace.csv?.delimiter ?? ',', other: workspace.csv?.other ?? '',
            qualifier: workspace.csv?.qualifier ?? '"',
            skipLines: workspace.csv?.skipLines ?? 0,
            hasHeader: workspace.csv?.hasHeader ?? true,
          },
          targetDb: workspace.targetDb ?? '', targetColl: workspace.targetColl ?? '',
          mode: workspace.mode ?? 'insert',
        }
      }
      return {
        format: 'json',
        validate: !!workspace.validate,
        sources: (workspace.sources || []).map(s => ({
          path: s.path, name: s.name,
          targetDb: s.targetDb, targetColl: s.targetColl, mode: s.mode,
        })),
      }
    },
    duplicate(workspace) {
      // The durable configuration (source + format options) is cloned; the preview
      // and the field mapping are re-derived from the source, so they start empty.
      if (workspace.format === 'csv') {
        return {
          title: workspace.title,
          target: resourceFromFeatureNode(toolTarget(workspace)),
          fields: {
            kind: 'import', ...toolTarget(workspace), format: 'csv',
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
        target: resourceFromFeatureNode(toolTarget(workspace)),
        fields: {
          kind: 'import', ...toolTarget(workspace), format: 'json',
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
    restore(saved) {
      // Restore re-derives preview state exactly like the current session service:
      // the CSV options come back with safe defaults, the JSON sources verbatim.
      if (saved.format === 'csv') {
        return {
          title: saved.title,
          target: resourceFromFeatureNode(toolTarget(saved)),
          fields: {
            kind: 'import', ...toolTarget(saved), format: 'csv',
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
        target: resourceFromFeatureNode(toolTarget(saved)),
        fields: {
          kind: 'import', ...toolTarget(saved), format: 'json',
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
      const target = toolTarget(ctx.target)
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
    serialize(workspace) {
      // The step, the frozen source/filter and the user's field mapping are the
      // tab's curation; the result banner is runtime state and never stored.
      return {
        step: workspace.step ?? 0, format: workspace.format ?? 'json',
        incremental: !!workspace.incremental,
        source: workspace.source ?? 'collection',
        sourceCount: workspace.sourceCount ?? null,
        filter: workspace.filter ?? '{}',
        fields: (workspace.fields || []).map(f => ({
          source: f.source, target: f.target, kind: f.kind, include: !!f.include,
        })),
      }
    },
    duplicate(workspace) {
      // The mapping and the frozen source/filter are the user's curation and must
      // survive; the result banner is runtime state and starts clear.
      return {
        title: workspace.title,
        target: resourceFromFeatureNode(toolTarget(workspace)),
        fields: {
          kind: 'export', ...toolTarget(workspace),
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
        target: resourceFromFeatureNode(toolTarget(saved)),
        fields: {
          kind: 'export', ...toolTarget(saved),
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
        target: resourceFromFeatureNode(toolTarget(ctx.target)),
        fields: {
          kind: 'currentOps',
          ...toolConnectionTarget(ctx.target),
          // Toolbar settings and grid state live on the tab so they survive tab
          // switches (the pane unmounts while another tab is active). opsDefaults is
          // a factory: the arrays and column order are per-tab, never shared.
          ...opsDefaults(),
        },
      }
    },
    serialize(workspace) {
      // Toolbar settings and the filter scope define what the tab watches; ops rows
      // and grid state are live server state and never stored.
      return {
        frequency: workspace.frequency ?? 2000,
        retention: workspace.retention ?? 10_000,
        ownOnly: !!workspace.ownOnly, showSys: !!workspace.showSys,
        slowOnly: !!workspace.slowOnly, slowSecs: workspace.slowSecs ?? 3,
        dbName: workspace.dbName || '', collName: workspace.collName || '',
        view: workspace.view || 'table',
      }
    },
    duplicate(workspace) {
      // The toolbar settings (frequency, filters, view) define what the tab watches;
      // the operation rows and grid state are live server state and start fresh.
      return {
        title: workspace.title,
        target: opsTarget(workspace),
        fields: {
          kind: 'currentOps', ...toolConnectionTarget(workspace),
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
      // resumes polling on mount. The target is the connection, never the filter
      // scope.
      return {
        title: saved.title,
        target: opsTarget(saved),
        fields: {
          kind: 'currentOps', ...toolConnectionTarget(saved),
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
