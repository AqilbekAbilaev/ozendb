import { PG_ACTIONS } from './tree/contextMenus'
import { showToast } from '../../stores/toast'
import { treeSelection } from '../../stores/connectionNavigation'
import { resolvePgMenuTarget } from '../../utils/menuContext'

// The PostgreSQL toolbar buttons (#163): each runs the right-click action with the same
// id on whatever pgMenuTarget resolves at the depth it needs, so the toolbar, the
// native menu and the sidebar all act on the same node.
const PG_TOOLS = {
  pgTable:  { action: 'pg:open_table',    level: 'table' },
  pgSql:    { action: 'pg:new_sql',       level: 'schema' },
  pgSearch: { action: 'pg:search_schema', level: 'schema' },
  pgExport: { action: 'pg:export_table',  level: 'table' },
  pgImport: { action: 'pg:import_csv',    level: 'table' },
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
