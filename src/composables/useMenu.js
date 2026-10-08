import { computed, watch } from 'vue'
import { setMenuContext } from '../appApi/menu'
import { deriveMenuContext, resolveMenuTarget, resolvePgMenuTarget } from '../utils/menuContext'
import { activeTab, tabs } from '../stores/tabs'
import { treeSelection } from '../stores/connectionNavigation'
import { openConnections } from '../stores/openConnections'
import { selectedIndex } from '../stores/indexes'
import { canRefreshWorkspace } from '../workspaces/lifecycle'

// Derives what the native menu treats as "selected" and keeps the backend menu in
// step with it, plus resolves the node a menu action should act on. The actual
// menu-action routing (handleMenuAction / menuNode) stays in App.vue — this owns
// only the selection-context derivation and the target resolution.
export function useMenu() {
  // What the native menu treats as "selected", so items enable/disable live. The
  // context is the UNION of the active tab and the sidebar/tree selection: a
  // collection tab satisfies all three, and so does a collection highlighted in the
  // tree even while Quickstart is the active tab (the original bug). `anyConnection`
  // is true whenever at least one connection is open — it gates Refresh All
  // Connections; View → Refresh gates on the active tab being able to reload.
  const menuContext = computed(() => deriveMenuContext(
    activeTab.value,
    treeSelection.value,
    openConnections.value.length,
    !!selectedIndex.value,
    canRefreshWorkspace(activeTab.value),
    tabs.value,
  ))

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
      readOnly: ctx.readOnly,
      canRefreshTab: ctx.canRefreshTab,
      hasPgSchema: ctx.hasPgSchema,
      hasPgTable: ctx.hasPgTable,
      engine: ctx.engine,
    }).catch(() => {})
  }, { immediate: true })

  // The node a native menu action should act on: the sidebar selection when there
  // is one (that's what the user just clicked in the tree), otherwise the active
  // tab. Shaped like a tab so it drops straight into the existing handlers.
  function menuTarget(requiredLevel = null) {
    return resolveMenuTarget(
      activeTab.value,
      treeSelection.value,
      requiredLevel,
    )
  }

  // The PostgreSQL sibling of menuTarget (#145) — see resolvePgMenuTarget.
  function pgMenuTarget(requiredLevel = null) {
    return resolvePgMenuTarget(
      activeTab.value,
      treeSelection.value,
      requiredLevel,
    )
  }

  const menuEngine = computed(() => menuContext.value.engine)

  return { menuTarget: menuTarget, pgMenuTarget: pgMenuTarget, menuEngine: menuEngine }
}
