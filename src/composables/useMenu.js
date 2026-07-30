import { computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { deriveMenuContext, resolveMenuTarget } from '../utils/menuContext'
import { activeTab } from '../stores/tabs'

// Derives what the native menu treats as "selected" and keeps the backend menu in
// step with it, plus resolves the node a menu action should act on. The actual
// menu-action routing (handleMenuAction / menuNode) stays in App.vue — this owns
// only the selection-context derivation and the target resolution.
export function useMenu({ treeSelection, treeConnectionCount, selectedIndex }) {
  // What the native menu treats as "selected", so items enable/disable live. The
  // context is the UNION of the active tab and the sidebar/tree selection: a
  // collection tab satisfies all three, and so does a collection highlighted in the
  // tree even while Quickstart is the active tab (the original bug). `anyConnection`
  // is true whenever at least one connection is open — it gates View → Refresh,
  // which refreshes every connection rather than one specific node.
  const menuContext = computed(() => deriveMenuContext(
    activeTab.value,
    treeSelection.value,
    treeConnectionCount.value,
    !!selectedIndex.value,
  ))

  // Push the context down to the native menu so gated items enable/disable in step
  // with the selection. Runs immediately for the initial (empty) state too.
  watch(menuContext, (ctx) => {
    invoke('set_menu_context', {
      hasConnection: ctx.hasConnection,
      hasDatabase: ctx.hasDatabase,
      hasCollection: ctx.hasCollection,
      anyConnection: ctx.anyConnection,
      hasDocument: ctx.hasDocument,
      hasField: ctx.hasField,
      hasIndex: ctx.hasIndex,
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

  return { menuTarget: menuTarget }
}
