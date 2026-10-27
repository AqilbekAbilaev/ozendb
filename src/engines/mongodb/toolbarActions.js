import { openCollectionTab, openShellTab, openSqlTab } from './tabs'
import { targetAt } from './tree/actions'
import { showToast } from '../../stores/toast'
import { treeSelection, setTreeSelection } from '../../stores/connectionNavigation'
import { activeTab } from '../../stores/tabs'
import { resourceAt } from '../../utils/resourceRef'
import { resolveMenuTarget } from './menu'

// Toolbar tool name → MongoDB action, run through the shared dispatcher so it gets the
// same level check and guidance as the right-click menu.
const TOOL_ALIASES = {
  aggregate: 'coll:aggregation',
  export:    'coll:export',
  import:    'coll:import',
  schema:    'coll:schema',
  search:    'file:search',
}

// Opens the collection the native menu resolved, else the one highlighted in the
// sidebar, same as double-clicking it. Opening makes it the active collection, whose
// highlight takes over — so the single-click selection is cleared rather than lingering
// as a second one.
function openCollectionTool(target) {
  const collection = resourceAt(target?.resource, 'collection')
  if (collection) {
    openCollectionTab({ resource: collection, connectionName: target.connectionName })
    return
  }
  const sel = treeSelection.value
  const selected = resourceAt(sel?.resource, 'collection')
  if (!selected) {
    showToast('Select a collection in the sidebar first')
    return
  }
  setTreeSelection(null)
  openCollectionTab({ resource: selected, connectionName: sel.connectionName })
}

// MongoDB's toolbar and native-menu tools. `target` is what the native menu already
// resolved, or null from the toolbar; `runFeature` is the shared dispatcher. False for
// a tool that isn't MongoDB's, so the caller tries the next engine.
export function runMongoTool(name, target, runFeature) {
  if (name === 'collection') {
    openCollectionTool(target)
    return true
  }
  if (name !== 'shell' && name !== 'sql' && !TOOL_ALIASES[name]) return false

  // The rest operate on a specific node. From the native menu the caller passes an
  // already-resolved target; from the toolbar it is the active workspace, resolved the
  // way the menu resolves it — through its target, and only when that names a MongoDB
  // resource.
  const resolved = target || resolveMenuTarget(activeTab.value, null)
  const ref = resolved?.resource ?? null
  const ctx = { connectionName: resolved?.connectionName ?? null }

  if (name === 'shell') {
    if (resourceAt(ref, 'database')) openShellTab(targetAt(ref, ctx, 'database'))
    else showToast('Select a database or collection first to open IntelliShell')
  } else if (name === 'sql') {
    if (resourceAt(ref, 'collection')) openSqlTab(targetAt(ref, ctx, 'collection'))
    else showToast('Select a collection first to open SQL')
  } else {
    runFeature(TOOL_ALIASES[name], ref, ctx)
  }
  return true
}
