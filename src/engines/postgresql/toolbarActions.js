import { PG_ACTIONS } from './tree/contextMenus'
import { showToast } from '../../stores/toast'
import { treeSelection } from '../../stores/connectionNavigation'
import { resolvePgMenuTarget } from '../../utils/menuContext'

// The PostgreSQL toolbar buttons (#163): each runs the right-click action of the same
// name on whatever pgMenuTarget resolves at the depth it needs, so the toolbar, the
// native menu and the sidebar all act on the same node.
const PG_TOOLS = {
  pgTable:  { action: 'Open Table',        level: 'table' },
  pgSql:    { action: 'New SQL Query',     level: 'schema' },
  pgSearch: { action: 'Search in Schema…', level: 'schema' },
  pgExport: { action: 'Export Table…',     level: 'table' },
  pgImport: { action: 'Import CSV…',       level: 'table' },
}

const HINT = {
  table: 'Select a PostgreSQL table first',
  schema: 'Select a PostgreSQL schema or table first',
}

// False for a tool that isn't PostgreSQL's, so the caller's own dispatcher runs it.
export function runPgTool(name, pgMenuTarget) {
  const tool = PG_TOOLS[name]
  if (!tool) return false
  // Table opens what's selected in the sidebar only, as MongoDB's Collection button
  // does: falling back to the active tab would open a second copy of it.
  if (name === 'pgTable') {
    const target = resolvePgMenuTarget(null, treeSelection.value, 'table')
    if (target?.table) PG_ACTIONS[tool.action](target)
    else showToast('Select a PostgreSQL table in the sidebar first')
    return true
  }
  const target = pgMenuTarget(tool.level)
  if (!target || (tool.level === 'table' && !target.table)) showToast(HINT[tool.level])
  else PG_ACTIONS[tool.action](target)
  return true
}
