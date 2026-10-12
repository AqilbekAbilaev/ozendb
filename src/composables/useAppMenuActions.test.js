import { describe, it, expect, beforeEach, vi } from 'vitest'

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

const { openModals, openModal, closeModal } = await import('../stores/modals')
const { useAppMenuActions } = await import('./useAppMenuActions')

function actions() {
  const menuTarget = vi.fn(() => ({ connectionId: 'c1', connectionName: 'Local', dbName: 'other' }))
  const { handleMenuAction } = useAppMenuActions({
    menuTarget, pgMenuTarget: vi.fn(), handleTool: vi.fn(), menuNode: vi.fn(),
    knownActions: new Set(), refreshAll: vi.fn(), toolbarHidden: { value: false },
  })
  return { handleMenuAction, menuTarget }
}

beforeEach(() => {
  closeModal('gridfs')
  vi.clearAllMocks()
})

// #258: a file action must reach the dialog the file was picked in, not one reopened on
// whatever database the tab or sidebar names.
describe('GridFS file actions', () => {
  it.each(['gridfs:view_file', 'gridfs:rename', 'gridfs:meta', 'gridfs:save', 'gridfs:remove'])(
    '%s signals the open dialog without resolving a database', (id) => {
      openModals.gridfs = { connectionId: 'c1', dbName: 'shop' }
      const { handleMenuAction, menuTarget } = actions()
      handleMenuAction(id)
      expect(menuTarget).not.toHaveBeenCalled()
      expect(openModal).not.toHaveBeenCalled()
      expect(openModals.gridfs).toMatchObject({ dbName: 'shop', menuRequest: { action: id } })
    })

  it('bucket actions still resolve their database', () => {
    openModals.gridfs = { connectionId: 'c1', dbName: 'shop' }
    const { handleMenuAction, menuTarget } = actions()
    handleMenuAction('gridfs:add')
    expect(menuTarget).toHaveBeenCalledWith('database')
    expect(openModal).toHaveBeenCalledWith('gridfs', expect.objectContaining({ dbName: 'other' }))
  })
})
