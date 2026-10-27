// PostgreSQL's native-menu items (#145), which composables/useAppMenuActions hands over
// by id (through engines/contextActions.js), and the node they act on.
import { openModal } from '../../stores/modals'
import { activeTab } from '../../stores/tabs'
import { treeSelection } from '../../stores/connectionNavigation'
import { openPostgresQuery, openPostgresSearch } from './tabs'
import { resolvePgMenuTarget } from './menu'

/** The node a PostgreSQL menu item acts on: the sidebar selection when it reaches `level`, else the active tab. */
export function pgMenuTarget(level = null) {
  return resolvePgMenuTarget(activeTab.value, treeSelection.value, level)
}

// The same handlers the table workspace's own toolbar/context menu already call
// (PG_ACTIONS). Each asks pgMenuTarget for the depth its gate required, so a sidebar
// selection deep enough for the action wins over the active tab and a shallower one
// falls back to it. The gates already guarantee one of the two qualifies, so a null
// target here means it went away between the menu enabling and the click — rare enough
// to no-op rather than toast.
const PG_MENU_ACTIONS = {
  'pg:new_sql': (target) => openPostgresQuery({ connectionId: target.connectionId, connectionName: target.connectionName, database: target.database }),
  'pg:create_table': (target) => openModal('pgCreateTable', target),
  'pg:search_schema': (target) => openPostgresSearch({
    connectionId: target.connectionId, connectionName: target.connectionName, database: target.database, schema: target.schema,
  }),
  'pg:row_history': (target) => target.table && openModal('sqlRowHistory', target),
  'pg:drop_table': (target) => target.table && openModal('pgDrop', target),
}

const LEVEL = { 'pg:row_history': 'table', 'pg:drop_table': 'table' }

/** Runs PostgreSQL's menu item `id`; false for an id that isn't PostgreSQL's. */
export function runPgMenuAction(id) {
  const run = PG_MENU_ACTIONS[id]
  if (!run) return false
  const target = pgMenuTarget(LEVEL[id] ?? 'schema')
  if (target) run(target)
  return true
}
