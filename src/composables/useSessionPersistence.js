import { watch } from 'vue'
import { listConnections } from '../engines/mongodb/api/connections'
import { getOpenTabs, setOpenTabs } from '../appApi/session'
import { tabs, activeTabId, activeTab } from '../stores/tabs'
import { restoreWorkspace } from '../workspaces/lifecycle'

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
        readOnly: !!t.readOnly,
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
      readOnly: !!t.readOnly,
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
  // A failed restore must never let the debounced autosave persist the truncated
  // (possibly empty) state that remains. The flag survives until the next restore
  // attempt; while set, saves are skipped entirely.
  let restoreFailed = false
  function scheduleSaveTabs() {
    if (restoreFailed) return
    clearTimeout(saveTabsTimer)
    saveTabsTimer = setTimeout(() => {
      setOpenTabs(projectSession()).catch(() => {})
    }, 400)
  }

  // Restore the previous session's tabs. Call before startAutoSave so the empty default
  // never overwrites tabs.json first. Reconstruction is definition-owned: every saved
  // record routes through restoreWorkspace, which derives the type from the saved
  // kind/mode, rebuilds fresh runtime state, and returns null for non-persisted kinds.
  async function restoreSession() {
    try {
      const session = await getOpenTabs()
      const saved = session?.tabs
      if (saved?.length) {
        const conns = await listConnections()
        const validIds = new Set(conns.map(c => c.id))
        // Never restore a tab that's already open. A second restore (App.vue remounting
        // over the module-scope `tabs` store — HMR does this) would otherwise push the
        // whole saved set on top of itself, and the doubled set gets persisted: that's
        // how one session grew to 9,182 tabs with 5 distinct ids.
        const open = new Set(tabs.value.map(t => t.id))
        const restored = saved
          // drop tabs for deleted connections (import tabs key on connId)
          .filter(t => validIds.has(t.connectionId || t.connId) && !open.has(t.id))
          .map(t => restoreWorkspace(t, { defaults: { queryLimit: 50, resultView: 'table' } }))
          .filter(Boolean)
        if (restored.length) {
          tabs.value.push(...restored)
          if (restored.some(t => t.id === session.activeTabId)) {
            activeTabId.value = session.activeTabId
          }
          // Lazily run the active restored tab (find mode re-runs its query; only
          // find restores carry the one-shot marker).
          const active = activeTab.value
          if (active && active._restored) runRestoredTab(active)
        }
      }
    } catch (_) {
      restoreFailed = true
    }
  }

  // Save on any change to the open tabs or the active tab. The watched getter reads only
  // persistable fields, so result-set updates don't trigger it. The stop handle is
  // returned so callers (and tests) can tear the watcher down.
  function startAutoSave() {
    return watch(() => JSON.stringify(projectSession()), scheduleSaveTabs)
  }

  return {
    restoreSession: restoreSession,
    startAutoSave: startAutoSave,
  }
}
