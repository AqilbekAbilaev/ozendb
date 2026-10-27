import { onMounted, onUnmounted } from 'vue'
import { showToast } from '../stores/toast'
import { openQuickstart } from '../stores/tabCreators'
import { useZoom } from './useZoom'
import { requestRefresh } from '../stores/menuRequests'
import { onMenuAction } from '../appApi/events'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'
import { HELP_URLS, HELP_MODALS, isHelpLink } from '../constants/helpLinks'
import { activeTabId, activeTab, closeTab, cycleTab } from '../stores/tabs'
import { canRefreshWorkspace } from '../workspaces/lifecycle'
import { openModal } from '../stores/modals'
import { checkNow as checkForUpdates } from '../stores/updater'
import { keyBindings } from '../stores/settings'
import { matchBinding } from '../utils/keybindings'
import { isEditingTarget } from '../utils/editingTarget'
import { runEngineMenuAction } from '../engines/contextActions.js'

// Native menu items that run a feature registered under another id: two items, one
// action. Every other id that names a feature runs it directly.
export const MENU_ALIASES = {
  'file:add_database': 'db:add_database',
  'db:collection_stats': 'coll:stats',
  'db:copy_all': 'db:copy_database',
  'db:paste_database': 'db:paste',
}

// The dispatchers come from useFeatures — App.vue constructs it once and hands over
// what this needs of it. `toolbarHidden` is App.vue's own layout state; the View menu
// just toggles it.
export function useAppMenuActions({ runFeature, menuNode, knownActions, refreshAll, toolbarHidden }) {
  const { zoomIn, zoomOut, resetZoom } = useZoom()
  const appWindow = getCurrentWindow()

  // Routes menu-bar actions (emitted by id) to the same handlers the toolbar and
  // right-click menus already use. The menu bar never emits a disabled item.
  function handleMenuAction(id) {
    // Help items are tables, not switch arms: most open the project's GitHub, the rest
    // open an app-level modal (see constants/helpLinks).
    if (isHelpLink(id)) {
      openUrl(HELP_URLS[id]).catch(() => showToast('Could not open link'))
      return
    }
    if (HELP_MODALS[id]) { openModal(HELP_MODALS[id]); return }
    // An engine's own items (engines/contextActions.js) resolve their own target.
    if (runEngineMenuAction(id, { runFeature: runFeature })) return
    switch (id) {
      // --- direct modals / app ---
      case 'file:connect':     openModal('connectionManager'); return
      case 'file:exit':        appWindow.close(); return
      case 'edit:preferences': openModal('preferences', undefined, { props: { initialTab: 'general' } }); return
      case 'help:shortcuts':   openModal('preferences', undefined, { props: { initialTab: 'keyboard' } }); return
      case 'help:quickstart':  openQuickstart(); return
      case 'help:updates':     checkForUpdates(); return

      // --- view ---
      // Refresh reloads the active tab when it only reads; the native menu is disabled
      // otherwise, but on Linux the key arrives here regardless (see onGlobalKeydown).
      case 'view:refresh':
        if (canRefreshWorkspace(activeTab.value)) requestRefresh()
        else showToast('Nothing to refresh in this tab')
        return
      case 'view:refresh_all':
        return refreshAll()

      // Tab navigation/closing. Close Tab and Close Tab (No Prompt) behave the same
      // today — there is no unsaved-changes prompt to differ on yet.
      case 'view:next_tab':      cycleTab(1); return
      case 'view:prev_tab':      cycleTab(-1); return
      case 'view:zoom_in':       zoomIn(); return
      case 'view:zoom_out':      zoomOut(); return
      case 'view:zoom_reset':    resetZoom(); return
      case 'view:close_tab':
      case 'view:close_tab_np':
        if (activeTabId.value != null) closeTab(activeTabId.value)
        return

      // Toggle the global toolbar. The native menu label stays "Hide Global Toolbar";
      // a toast reports the resulting state.
      case 'view:hide_toolbar':
        toolbarHidden.value = !toolbarHidden.value
        showToast(toolbarHidden.value ? 'Toolbar hidden' : 'Toolbar shown')
        return
    }
    // Everything else that names a feature (directly, or through MENU_ALIASES) runs it
    // on the menu's target, at the level the feature itself declares.
    const action = MENU_ALIASES[id] ?? id
    if (knownActions.has(action)) menuNode(action)
  }

  // Two ways an action arrives: the native menu emits the clicked item's id, and on
  // Linux — where WebKitGTK swallows native accelerators, so menu.rs attaches none —
  // the webview matches the keyboard against the user's bindings itself.
  const nativeMenuOwnsShortcuts = !/Linux/i.test(navigator.userAgent)
  // #146: macOS reserves Ctrl+Tab/Ctrl+Shift+Tab for Cocoa's key-view-loop
  // navigation, claimed earlier in the dispatch pipeline than any menu accelerator —
  // so the native menu item for these two never fires from the keyboard (clicking it
  // still works). The keystroke still reaches the webview as an ordinary keydown, so
  // catch just these two here. matchBinding still honors a user rebind of either id.
  const isMac = /Mac/i.test(navigator.userAgent)
  const TAB_NAV_IDS = new Set(['view:next_tab', 'view:prev_tab'])

  function onGlobalKeydown(e) {
    if (isEditingTarget(e.target)) return
    const id = matchBinding(e, keyBindings.value)
    if (id) {
      e.preventDefault()
      handleMenuAction(id)
    }
  }

  function onTabNavKeydown(e) {
    if (isEditingTarget(e.target)) return
    const id = matchBinding(e, keyBindings.value)
    if (id && TAB_NAV_IDS.has(id)) {
      e.preventDefault()
      handleMenuAction(id)
    }
  }

  let unlisten
  onMounted(() => {
    unlisten = onMenuAction(handleMenuAction)
    if (!nativeMenuOwnsShortcuts) window.addEventListener('keydown', onGlobalKeydown)
    else if (isMac) window.addEventListener('keydown', onTabNavKeydown)
  })
  onUnmounted(() => {
    unlisten.then(off => off())
    window.removeEventListener('keydown', onGlobalKeydown)
    window.removeEventListener('keydown', onTabNavKeydown)
  })

  return { handleMenuAction }
}
