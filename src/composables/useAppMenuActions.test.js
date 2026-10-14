import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
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

const { openModals, openModal, closeModal } = await import('../stores/modals')
const { gridfsMenuRequest } = await import('../stores/menuRequests')
const { useAppMenuActions } = await import('./useAppMenuActions')

function actions() {
  const menuTarget = vi.fn(() => ({ resource: db('c1', 'other'), connectionName: 'Local' }))
  const { handleMenuAction } = useAppMenuActions({
    menuTarget, pgMenuTarget: vi.fn(), handleTool: vi.fn(), menuNode: vi.fn(),
    knownActions: new Set(), refreshAll: vi.fn(), toolbarHidden: { value: false },
  })
  return { handleMenuAction, menuTarget }
}

const db = (connectionId, name) => createResourceRef(connectionId, [{ kind: 'database', name: name }])

beforeEach(() => {
  closeModal('gridfs')
  gridfsMenuRequest.value = null
  vi.clearAllMocks()
})

// #258: a file action must reach the dialog the file was picked in, not one reopened on
// whatever database the tab or sidebar names.
describe('GridFS file actions', () => {
  it.each(['gridfs:view_file', 'gridfs:rename', 'gridfs:meta', 'gridfs:save', 'gridfs:remove'])(
    '%s signals the open dialog without resolving a database', (id) => {
      openModals.gridfs = { resource: db('c1', 'shop') }
      const { handleMenuAction, menuTarget } = actions()
      handleMenuAction(id)
      expect(menuTarget).not.toHaveBeenCalled()
      expect(openModal).not.toHaveBeenCalled()
      expect(gridfsMenuRequest.value).toMatchObject({ action: id })
    })

  // #288: AppModals keys each dialog on its payload, so the request must travel through
  // the menu-request store. A payload that grew a request would remount the dialog and
  // lose the file the action was aimed at.
  it.each(['gridfs:view_file', 'gridfs:add'])('%s leaves the dialog payload untouched', async (id) => {
    openModals.gridfs = { resource: db('c1', 'other') }
    const { handleMenuAction } = actions()
    handleMenuAction(id)
    await nextTick()
    expect(gridfsMenuRequest.value).toMatchObject({ action: id })
    expect(openModals.gridfs).toEqual({ resource: db('c1', 'other') })
  })

  it('bucket actions still resolve their database', () => {
    openModals.gridfs = { resource: db('c1', 'shop') }
    const { handleMenuAction, menuTarget } = actions()
    handleMenuAction('gridfs:add')
    expect(menuTarget).toHaveBeenCalledWith('database')
    expect(openModal).toHaveBeenCalledWith('gridfs', { resource: db('c1', 'other'), connectionName: 'Local' })
  })

  // With a collection selected in the sidebar, the menu resolves to that collection;
  // GridFS belongs to its database.
  it('opens on the database of a resolved collection', () => {
    const { handleMenuAction, menuTarget } = actions()
    menuTarget.mockReturnValue({
      resource: createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]),
      connectionName: 'Local',
    })
    handleMenuAction('gridfs:add')
    expect(openModal).toHaveBeenCalledWith('gridfs', { resource: db('c1', 'shop'), connectionName: 'Local' })
  })

  it('keeps the open dialog when it already shows the resolved database', () => {
    openModals.gridfs = { resource: db('c1', 'other') }
    const { handleMenuAction } = actions()
    handleMenuAction('gridfs:add')
    expect(openModal).not.toHaveBeenCalled()
  })
})
