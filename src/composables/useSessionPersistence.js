import { watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { tabs, activeTabId, activeTab } from '../stores/tabs'
import { opsDefaults } from './useCurrentOps'

// Tab-session persistence. Persists open collection/shell/import/index tabs (and which one is active)
// so they return after a restart. Only the persistable fields are projected — result sets
// and other runtime state are rebuilt on demand, so paging through data never saves. The
// tab spine (`tabs`, `activeTabId`) comes from the store; `runRestoredTab` re-runs a
// restored find tab's stored query in place.
export function useSessionPersistence({ runRestoredTab }) {
  // Import tabs persist their target + chosen format + the list of sources (each a
  // file path plus its target db/collection/insertion mode). Preview data is
  // re-derived on demand, so it isn't stored.
  function projectTab(t) {
    if (t.kind === 'shell') {
      return {
        id: t.id, kind: 'shell', title: t.title, color: t.color,
        connectionId: t.connectionId, connectionName: t.connectionName,
        dbName: t.dbName, code: t.code, scriptPath: t.scriptPath || null,
      }
    }
    if (t.kind === 'import') {
      const target = {
        id: t.id, kind: 'import', title: t.title, color: t.color,
        connId: t.connId, connName: t.connName,
        dbName: t.dbName, collName: t.collName,
        format: t.format,
      }
      if (t.format === 'csv') {
        // CSV: single source + options + target. The field mapping is re-derived
        // from the source preview, so it isn't stored.
        return {
          ...target,
          sourceType: t.sourceType, filePath: t.filePath || '',
          csv: {
            delimiter: t.csv.delimiter, other: t.csv.other,
            qualifier: t.csv.qualifier, skipLines: t.csv.skipLines, hasHeader: t.csv.hasHeader,
          },
          targetDb: t.targetDb, targetColl: t.targetColl, mode: t.mode,
        }
      }
      return {
        ...target,
        validate: !!t.validate,
        sources: (t.sources || []).map(s => ({
          path: s.path, name: s.name,
          targetDb: s.targetDb, targetColl: s.targetColl, mode: s.mode,
        })),
      }
    }
    if (t.kind === 'export') {
      // Export tab: the field mapping is the user's curation, so it's worth keeping;
      // the sample rows behind the preview are re-fetched on mount. `result` is not
      // stored — a previous run's success banner would be stale on restart.
      return {
        id: t.id, kind: 'export', title: t.title, color: t.color,
        connId: t.connId, connName: t.connName,
        dbName: t.dbName, collName: t.collName,
        step: t.step, format: t.format, incremental: !!t.incremental,
        // The source and its frozen filter define what the export covers, so they
        // must come back with it — a restored tab that quietly widened to the whole
        // collection would export more than the user set up.
        source: t.source || 'collection', sourceCount: t.sourceCount ?? null,
        filter: t.filter || '{}',
        fields: (t.fields || []).map(f => ({
          source: f.source, target: f.target, kind: f.kind, include: !!f.include,
        })),
      }
    }
    if (t.kind === 'indexes') {
      // Index Manager tab: a thin shell keyed on the collection. The pane reloads
      // its index list + metrics itself on mount, so only the identity is stored.
      return {
        id: t.id, kind: 'indexes', title: t.title, color: t.color,
        connId: t.connId, connName: t.connName,
        dbName: t.dbName, collName: t.collName,
      }
    }
    if (t.kind === 'currentOps') {
      // Current Operations tab: identity + the toolbar settings that define what it
      // watches. The operations themselves are live server state, so they aren't stored.
      return {
        id: t.id, kind: 'currentOps', title: t.title, color: t.color,
        connId: t.connId, connName: t.connName,
        frequency: t.frequency, retention: t.retention,
        ownOnly: !!t.ownOnly, showSys: !!t.showSys,
        slowOnly: !!t.slowOnly, slowSecs: t.slowSecs,
        dbName: t.dbName, collName: t.collName, view: t.view,
      }
    }
    if (t.mode === 'sql') {
      // SQL tab: a collection tab whose query is SQL. Only identity + the SQL text
      // are stored; the translated find pieces are re-derived on the next Run.
      return {
        id: t.id, kind: 'collection', title: t.title, color: t.color,
        connectionId: t.connectionId, connectionName: t.connectionName,
        dbName: t.dbName, collectionName: t.collectionName,
        mode: 'sql', sql: t.sql || '',
        colOrder: t.colOrder || null,
      }
    }
    return {
      id: t.id, kind: 'collection', title: t.title, color: t.color,
      connectionId: t.connectionId, connectionName: t.connectionName,
      dbName: t.dbName, collectionName: t.collectionName,
      filter: t.filter, sort: t.sort, projection: t.projection,
      skip: t.skip, limit: t.limit, mode: t.mode, pipeline: t.pipeline,
      vqb: t.vqb,
      colOrder: t.colOrder || null,
    }
  }

  function projectSession() {
    return {
      activeTabId: activeTabId.value,
      tabs: tabs.value
        .filter(t => t.kind === 'collection' || t.kind === 'shell' || t.kind === 'import' || t.kind === 'indexes' || t.kind === 'export' || t.kind === 'currentOps')
        .map(projectTab),
    }
  }

  let saveTabsTimer = null
  function scheduleSaveTabs() {
    clearTimeout(saveTabsTimer)
    saveTabsTimer = setTimeout(() => {
      invoke('set_open_tabs', { session: projectSession() }).catch(() => {})
    }, 400)
  }

  // Restore the previous session's tabs. Call before startAutoSave so the empty default
  // never overwrites tabs.json first.
  async function restoreSession() {
    try {
      const session = await invoke('get_open_tabs')
      const saved = session?.tabs
      if (saved?.length) {
        const conns = await invoke('list_connections')
        const validIds = new Set(conns.map(c => c.id))
        // Never restore a tab that's already open. A second restore (App.vue remounting
        // over the module-scope `tabs` store — HMR does this) would otherwise push the
        // whole saved set on top of itself, and the doubled set gets persisted: that's
        // how one session grew to 9,182 tabs with 5 distinct ids.
        const open = new Set(tabs.value.map(t => t.id))
        const restored = saved
          // drop tabs for deleted connections (import tabs key on connId)
          .filter(t => validIds.has(t.connectionId || t.connId) && !open.has(t.id))
          .map(t => t.kind === 'import'
            ? (t.format === 'csv'
              ? {
                  // CSV import tab. The field mapping is re-derived from the source
                  // preview (the referenced file may have changed), so start empty.
                  id: t.id, kind: 'import', title: t.title, color: t.color,
                  connId: t.connId, connName: t.connName,
                  dbName: t.dbName, collName: t.collName,
                  format: 'csv',
                  subTab: 'source',
                  sourceType: t.sourceType || 'file', filePath: t.filePath || '',
                  csv: {
                    delimiter: t.csv?.delimiter ?? ',', other: t.csv?.other ?? '',
                    qualifier: t.csv?.qualifier ?? '"', skipLines: t.csv?.skipLines ?? 0,
                    hasHeader: t.csv?.hasHeader ?? true,
                  },
                  targetDb: t.targetDb, targetColl: t.targetColl, mode: t.mode || 'insert',
                  fields: [],
                }
              : {
                  // JSON import tab: restore its sources; preview is re-derived on demand.
                  id: t.id, kind: 'import', title: t.title, color: t.color,
                  connId: t.connId, connName: t.connName,
                  dbName: t.dbName, collName: t.collName,
                  format: t.format, validate: !!t.validate,
                  sources: (t.sources || []).map(s => ({
                    path: s.path, name: s.name,
                    targetDb: s.targetDb, targetColl: s.targetColl, mode: s.mode,
                  })),
                  selectedSource: (t.sources && t.sources.length) ? 0 : -1,
                  previewOpen: false,
                })
            : t.kind === 'shell'
            ? {
                // Rebuild a shell tab with a fresh backend session (JS contexts are
                // ephemeral); the editor text is restored, history loads on mount.
                id: t.id, kind: 'shell', title: t.title, color: t.color,
                connectionId: t.connectionId, connectionName: t.connectionName,
                dbName: t.dbName,
                sessionId: (crypto.randomUUID ? crypto.randomUUID() : t.id),
                code: t.code || '', scriptPath: t.scriptPath || null, history: [], isRunning: false,
                results: [], resultView: 'table', resultTab: 'Console',
                runError: null, elapsedMs: null, drillPath: [], hasRun: false, selectedRow: -1, selectedRows: [],
                logs: [], scalar: undefined, hasScalar: false,
              }
            : t.kind === 'export'
            ? {
                // Export tab: mapping and format come back; the preview re-samples on
                // mount and the result banner starts clear.
                id: t.id, kind: 'export', title: t.title, color: t.color,
                connId: t.connId, connName: t.connName,
                dbName: t.dbName, collName: t.collName,
                step: t.step || 0, format: t.format || 'json', incremental: !!t.incremental,
                source: t.source || 'collection', sourceCount: t.sourceCount ?? null,
                filter: t.filter || '{}',
                fields: (t.fields || []).map(f => ({
                  source: f.source, target: f.target, kind: f.kind, include: !!f.include,
                })),
                result: null,
              }
            : t.kind === 'indexes'
            ? {
                // Index Manager tab: identity only; the pane reloads its list on mount.
                id: t.id, kind: 'indexes', title: t.title, color: t.color,
                connId: t.connId, connName: t.connName,
                dbName: t.dbName, collName: t.collName,
              }
            : t.kind === 'currentOps'
            ? {
                // Current Operations tab: defaults first, then the saved settings on top —
                // the runtime state (ops, grid) starts empty and the pane polls on mount.
                ...opsDefaults(),
                id: t.id, kind: 'currentOps', title: t.title, color: t.color,
                connId: t.connId, connName: t.connName,
                frequency: t.frequency ?? 2000, retention: t.retention ?? 10_000,
                ownOnly: !!t.ownOnly, showSys: !!t.showSys,
                slowOnly: !!t.slowOnly, slowSecs: t.slowSecs ?? 3,
                dbName: t.dbName || '', collName: t.collName || '', view: t.view || 'table',
              }
            : t.mode === 'sql'
            ? {
                // SQL tab: restore the editor text but don't auto-run — the find
                // pieces are re-derived on the next Run (like a freshly opened tab).
                id: t.id, kind: 'collection', title: t.title, color: t.color,
                connectionId: t.connectionId, connectionName: t.connectionName,
                dbName: t.dbName, collectionName: t.collectionName,
                mode: 'sql', sql: t.sql || '', sqlError: null,
                filter: '', projection: '', sort: '', skip: 0, limit: 50, pipeline: '',
                vqb: null, colOrder: t.colOrder || {},
                results: [], hasRun: false, isRunning: false, runError: null,
                selectedRow: -1, selectedRows: [], elapsedMs: null,
              }
            : {
                ...t,
                results: [], hasRun: false, isRunning: false, runError: null,
                selectedRow: -1, selectedRows: [], elapsedMs: null, _restored: true,
              })
        if (restored.length) {
          tabs.value.push(...restored)
          if (restored.some(t => t.id === session.activeTabId)) {
            activeTabId.value = session.activeTabId
          }
          // Lazily run the active restored tab (find mode re-runs its query).
          const active = activeTab.value
          if (active && active._restored) runRestoredTab(active)
        }
      }
    } catch (_) {}
  }

  // Save on any change to the open tabs or the active tab. The watched getter reads only
  // persistable fields, so result-set updates don't trigger it.
  function startAutoSave() {
    watch(() => JSON.stringify(projectSession()), scheduleSaveTabs)
  }

  return {
    restoreSession: restoreSession,
    startAutoSave: startAutoSave,
  }
}
