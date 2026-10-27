import { computed, watch } from 'vue'
import { setMenuContext } from '../appApi/menu'
import { deriveMenuContext } from '../utils/menuContext'
import { activeTab, tabs } from '../stores/tabs'
import { treeSelection } from '../stores/connectionNavigation'
import { openConnections } from '../stores/openConnections'
import { canRefreshWorkspace } from '../workspaces/lifecycle'
import { ENGINES } from '../engines/index.js'

// Derives what the native menu treats as "selected" and keeps the backend menu in
// step with it. The menu-action routing is useAppMenuActions', and which node an item
// acts on is each engine's own (engines/*/menu.js) — this owns only the selection-context
// derivation.
export function useMenu() {
  // What the native menu treats as "selected", so items enable/disable live. The
  // context is the UNION of the active tab and the sidebar/tree selection: a
  // collection tab satisfies all three, and so does a collection highlighted in the
  // tree even while Quickstart is the active tab (the original bug). `anyConnection`
  // is true whenever at least one connection is open — it gates Refresh All
  // Connections; View → Refresh gates on the active tab being able to reload.
  const menuContext = computed(() => deriveMenuContext({
    activeTab: activeTab.value,
    treeSelection: treeSelection.value,
    connectionCount: openConnections.value.length,
    canRefresh: canRefreshWorkspace(activeTab.value),
    openTabs: tabs.value,
    engines: Object.values(ENGINES),
  }))

  // Push the context down to the native menu so gated items enable/disable in step
  // with the selection. Runs immediately for the initial (empty) state too.
  watch(menuContext, (ctx) => {
    setMenuContext({
      hasConnection: ctx.hasConnection,
      hasDatabase: ctx.hasDatabase,
      hasCollection: ctx.hasCollection,
      anyConnection: ctx.anyConnection,
      hasDocument: ctx.hasDocument,
      hasField: ctx.hasField,
      hasIndex: ctx.hasIndex,
      hasGridfsFile: ctx.hasGridfsFile,
      readOnly: ctx.readOnly,
      canRefreshTab: ctx.canRefreshTab,
      hasPgSchema: ctx.hasPgSchema,
      hasPgTable: ctx.hasPgTable,
      engine: ctx.engine,
    }).catch(() => {})
  }, { immediate: true })

  const menuEngine = computed(() => menuContext.value.engine)

  return { menuEngine: menuEngine }
}
