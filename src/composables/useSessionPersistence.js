import { watch } from 'vue'
import { listConnections } from '../engines/mongodb/api/connections'
import { getOpenTabs, setOpenTabs } from '../appApi/session'
import { tabs, activeTabId, activeTab } from '../stores/tabs'
import { restoreWorkspace } from '../workspaces/lifecycle'
import { getWorkspaceDefinition } from '../workspaces/registry'
import { migrateSession, toLegacyRecord } from '../utils/sessionMigration'

// Tab-session persistence (Work 7). On-disk sessions are canonical v2 records;
// legacy unversioned files migrate in memory on load and are written back as v2.
// Result sets and other runtime state are rebuilt on demand, so paging through
// data never saves. The tab spine (`tabs`, `activeTabId`) comes from the store;
// `runRestoredTab` re-runs a restored find tab's stored query in place.
export function useSessionPersistence({ runRestoredTab }) {
  // Serialize a live tab into its canonical v2 record. Durable state is
  // definition-owned via the serialize hook; identity is the canonical target.
  // Tabs without a type predate the registry and cannot be serialized — skip them.
  function projectTab(t) {
    if (!t || !t.type) return null
    const def = getWorkspaceDefinition(t.type)
    return {
      id: t.id,
      type: t.type,
      engine: t.engine,
      title: t.title,
      color: t.color,
      target: t.target,
      state: def.serialize ? def.serialize(t) : {},
    }
  }

  function projectSession() {
    return {
      schemaVersion: 2,
      activeTabId: activeTabId.value,
      // App-level tabs (quickstart) are launch surfaces, not session state.
      tabs: tabs.value.filter((t) => t && t.type && t.engine !== 'app').map(projectTab),
    }
  }

  let saveTabsTimer = null
  // Autosave is armed only after a successful load. A failed load leaves the file
  // untouched (or quarantined server-side) — a truncated or future-version file
  // must never be overwritten with whatever empty state the app fell back to.
  let autosaveEnabled = false
  function scheduleSaveTabs() {
    if (!autosaveEnabled) return
    clearTimeout(saveTabsTimer)
    saveTabsTimer = setTimeout(() => {
      setOpenTabs(projectSession()).catch(() => {})
    }, 400)
  }

  // Load + validate once, then restore if asked. Returns a diagnostics shape the
  // caller can ignore: `{ ok, sourceVersion, migrated, warnings }` or a failure
  // with `reason`. When ok and the file was legacy, it is written back as v2.
  async function initializeSession({ restore } = {}) {
    let raw
    try {
      raw = await getOpenTabs()
    } catch {
      autosaveEnabled = false
      return { ok: false, reason: 'read-failed' }
    }
    // A connection-list failure must not read as "every connection was deleted",
    // so the migration prunes only when the list is available.
    let conns = []
    let connectionIds = null
    try {
      conns = await listConnections()
      connectionIds = new Set(conns.map((c) => c.id))
    } catch {
      // keep conns empty and connectionIds null
    }
    // A missing (or server-quarantined) file is a first run, not an invalid one.
    const result = raw === null || raw === undefined
      ? { ok: true, session: { schemaVersion: 2, activeTabId: null, tabs: [] }, sourceVersion: 2, migrated: false, warnings: [] }
      : migrateSession(raw, { connections: connectionIds })
    if (!result.ok) {
      autosaveEnabled = false
      return { ok: false, reason: result.reason, schemaVersion: result.schemaVersion }
    }
    autosaveEnabled = true
    // The migrated v2 shape becomes the file, so the next launch is a plain v2 read.
    if (result.migrated) setOpenTabs(result.session).catch(() => {})

    if (restore) {
      const names = new Map(conns.map((c) => [c.id, c.name]))
      // Never restore a tab that's already open. A second initialize (App.vue
      // remounting over the module-scope `tabs` store — HMR does this) would
      // otherwise push the whole saved set on top of itself, and the doubled set
      // gets persisted: that's how one session grew to 9,182 tabs with 5 ids.
      const open = new Set(tabs.value.map((t) => t.id))
      const restored = result.session.tabs
        .filter((t) => !open.has(t.id))
        .map((record) => toLegacyRecord(record, names.get(record.target.connectionId) ?? null))
        .map((record) => record && restoreWorkspace(record, { defaults: { queryLimit: 50, resultView: 'table' } }))
        .filter(Boolean)
      if (restored.length) {
        tabs.value.push(...restored)
        // Activate the session's active tab only when it is among the restored set.
        // A requested id that is not a session tab (the always-present quickstart)
        // leaves the current active tab in charge.
        const wanted = result.requestedActiveTabId ?? result.session.activeTabId
        if (restored.some((t) => t.id === wanted)) {
          activeTabId.value = wanted
        }
        // Lazily run the active restored tab (find mode re-runs its query; only
        // find restores carry the one-shot marker).
        const active = activeTab.value
        if (active && active._restored) runRestoredTab(active)
      }
    }
    return { ok: true, sourceVersion: result.sourceVersion, migrated: result.migrated, warnings: result.warnings }
  }

  // Save on any change to the open tabs or the active tab. The watched getter reads
  // only persistable fields, so result-set updates don't trigger it. The stop
  // handle is returned so callers (and tests) can tear the watcher down.
  let watchStop = null
  function startAutoSave() {
    watchStop = watch(() => JSON.stringify(projectSession()), scheduleSaveTabs)
    return watchStop
  }

  // Cancel the watcher and any pending debounced save. HMR-stale instances hold
  // their own stop handle, so an unmounted App.vue can never save over the live
  // session.
  function stopAutoSave() {
    if (watchStop) {
      watchStop()
      watchStop = null
    }
    clearTimeout(saveTabsTimer)
  }

  return {
    initializeSession: initializeSession,
    startAutoSave: startAutoSave,
    stopAutoSave: stopAutoSave,
  }
}