import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createResourceRef } from '../utils/resourceRef'

// The tab store builds its module-scope Quickstart through a definition, so the
// registry must be populated before this composable (which imports it) evaluates.
import { registerWorkspaceDefinitions } from '../workspaces/registerDefinitions'
registerWorkspaceDefinitions()

vi.stubGlobal('navigator', { userAgent: '' })
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: vi.fn() }) }))
vi.mock('../appApi/events', () => ({ onMenuAction: vi.fn(() => Promise.resolve(() => {})) }))
vi.mock('../stores/toast', () => ({ showToast: vi.fn() }))
vi.mock('../stores/modals', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, openModal: vi.fn(actual.openModal) }
})

const { openModal, closeModal } = await import('../stores/modals')
const { setTreeSelection } = await import('../stores/connectionNavigation')
const { useAppMenuActions } = await import('./useAppMenuActions')

function actions() {
  const menuNode = vi.fn()
  const { handleMenuAction } = useAppMenuActions({
    runFeature: vi.fn(), menuNode, knownActions: new Set(['coll:stats']), refreshAll: vi.fn(), toolbarHidden: { value: false },
  })
  return { handleMenuAction, menuNode }
}

beforeEach(() => {
  setTreeSelection(null)
  vi.clearAllMocks()
})

// An engine's own items (engines/*/menuActions.js) are reached by id, on the node the
// engine resolves itself.
describe('Row History', () => {
  it('opens the shared SQL row history on the menu bar\'s PostgreSQL table', () => {
    setTreeSelection({
      engine: 'postgresql', connectionName: 'Local PG',
      resource: createResourceRef('c1', [
        { kind: 'database', name: 'app db' }, { kind: 'schema', name: 'sales ü' }, { kind: 'table', name: 'order.items' },
      ]),
    })
    actions().handleMenuAction('pg:row_history')
    expect(openModal).toHaveBeenCalledWith('sqlRowHistory', {
      connId: 'c1', engine: 'postgresql', connName: 'Local PG', connectionId: 'c1', connectionName: 'Local PG',
      database: 'app db', schema: 'sales ü', table: 'order.items',
    })
    closeModal('sqlRowHistory')
  })
})

describe('features run by id', () => {
  it('runs a feature on the menu\'s target, directly or through an alias', () => {
    const { handleMenuAction, menuNode } = actions()
    handleMenuAction('coll:stats')
    handleMenuAction('db:collection_stats')
    expect(menuNode.mock.calls).toEqual([['coll:stats'], ['coll:stats']])
  })
})
