import { PG_ACTIONS } from './tree/contextMenus'
import { showToast } from '../../stores/toast'

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
  const target = pgMenuTarget(tool.level)
  if (!target || (tool.level === 'table' && !target.table)) showToast(HINT[tool.level])
  else PG_ACTIONS[tool.action](target)
  return true
}
