import { sameResource } from '../utils/resourceRef'
import { tabs, activateTab, newTabId } from './tabs'
import { createWorkspace } from '../workspaces/createWorkspace'

// What every "open a tab" entry point repeats, plus Quickstart, the one tab no engine
// owns. Each engine's openers live in its own `src/engines/<engine>/tabs.js` and decide
// which opens focus an existing tab, which load and run a default query, and which
// start in a modal. The tab *shape* is owned by the workspace definitions; the tab
// state and its mutations live in tabs.js.

// A new workspace of `type`, not yet on the tab strip, for an opener that seeds it first.
export function newWorkspaceTab(type, context) {
  return createWorkspace(type, { ...context, ids: { workspace: newTabId } })
}

// Appends `tab` to the tab strip and activates it.
export function showWorkspaceTab(tab) {
  tabs.value.push(tab)
  activateTab(tab.id)
}

// Appends a new workspace of `type` to the tab strip and activates it.
export function openWorkspaceTab(type, context) {
  showWorkspaceTab(newWorkspaceTab(type, context))
}

// One tab per target: focuses the tab of `type` already showing `resource`, or opens one.
export function focusOrOpenWorkspaceTab(type, resource, context) {
  const existing = tabs.value.find(t => t.type === type && sameResource(t.target, resource))
  if (existing) { activateTab(existing.id); return }
  openWorkspaceTab(type, context)
}

// Help → Quickstart: focus the existing Quickstart tab, or open one if it was closed.
export function openQuickstart() {
  const existing = tabs.value.find(t => t.type === 'app.quickstart')
  if (existing) {
    activateTab(existing.id)
    return
  }
  openWorkspaceTab('app.quickstart', {})
}
