import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { createResourceRef } from '../../utils/resourceRef'

// The tab store builds its module-scope Quickstart through a definition, so the
// registry must be populated before any import that evaluates it. Static imports run
// before this file's body, hence the dynamic imports below.
import { registerWorkspaceDefinitions } from '../../workspaces/registerDefinitions'
registerWorkspaceDefinitions()

vi.mock('../../stores/toast', () => ({ showToast: vi.fn() }))
vi.mock('./tabs', () => ({
  openCollectionTab: vi.fn(), openShellTab: vi.fn(), openIndexManagerTab: vi.fn(),
  openSqlTab: vi.fn(), openSchemaTab: vi.fn(), openSearchTab: vi.fn(),
  openCurrentOpsTab: vi.fn(), openExportSource: vi.fn(),
}))
vi.mock('../../stores/modals', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, openModal: vi.fn(actual.openModal) }
})

const { openModals, openModal, closeModal } = await import('../../stores/modals')
const { gridfsMenuRequest } = await import('../../stores/menuRequests')
const { showToast } = await import('../../stores/toast')
const { openCollectionTab } = await import('./tabs')
const { setTreeSelection } = await import('../../stores/connectionNavigation')
const { tabs, activeTabId } = await import('../../stores/tabs')
const { vqbOpen } = await import('./query/visualQueryBuilder')
const { runMongoMenuAction } = await import('./menuActions')

const db = (connectionId, name) => createResourceRef(connectionId, [{ kind: 'database', name: name }])
const coll = (connectionId, dbName, name) => createResourceRef(connectionId, [
  { kind: 'database', name: dbName }, { kind: 'collection', name: name },
])
const select = (resource) => setTreeSelection({ resource: resource, connectionName: 'Local', engine: 'mongodb' })
const run = (id) => runMongoMenuAction(id, { runFeature: vi.fn() })

beforeEach(() => {
  closeModal('gridfs')
  gridfsMenuRequest.value = null
  vqbOpen.value = false
  tabs.value = []
  activeTabId.value = null
  setTreeSelection(null)
  vi.clearAllMocks()
})

// Every native-menu id MongoDB answers for (src-tauri/src/menu/table.rs). One that
// stops being claimed would fall through to useAppMenuActions and do nothing.
describe('MongoDB menu coverage', () => {
  const MONGO_ITEMS = [
    'coll:vqb', 'file:intellishell', 'file:sql', 'file:search', 'coll:open_tab', 'coll:export', 'coll:import',
    'file:load', 'file:save', 'view:history',
    'gridfs:add', 'gridfs:save', 'gridfs:remove', 'gridfs:view_file', 'gridfs:rename', 'gridfs:meta',
    'gridfs:copy_bucket', 'gridfs:drop_bucket',
    'idx:edit', 'idx:view', 'idx:copy', 'idx:drop', 'idx:hide', 'idx:unhide',
    'coll:insert_document', 'coll:update_dialog', 'coll:delete_dialog', 'coll:clear', 'edit:paste_documents',
    'edit:copy', 'edit:copy_value', 'edit:copy_field', 'edit:copy_field_path', 'edit:copy_document',
    'doc:edit_value', 'doc:add_field', 'doc:remove_field', 'doc:rename_field', 'doc:view_json', 'doc:edit_json', 'doc:delete',
    'view:tree', 'view:table', 'view:json', 'view:refresh_document', 'view:step_column', 'view:step_cell', 'view:step_out',
  ]

  it('claims every MongoDB item', () => {
    expect(MONGO_ITEMS.filter((id) => !run(id))).toEqual([])
  })

  it('leaves app-wide items, PostgreSQL\'s and the features run by id to others', () => {
    expect(['view:zoom_in', 'view:refresh', 'pg:new_sql', 'coll:stats', 'db:add_database'].filter(run)).toEqual([])
  })
})

describe('Visual Query Builder', () => {
  it('opens the resolved collection with the builder showing', () => {
    select(coll('c 1', 'shop.eu', 'orders/2024'))
    run('coll:vqb')
    expect(openCollectionTab).toHaveBeenCalledWith({ resource: coll('c 1', 'shop.eu', 'orders/2024'), connectionName: 'Local' })
    expect(vqbOpen.value).toBe(true)
  })

  it('asks for a collection when only a database is in focus', () => {
    select(db('c 1', 'shop.eu'))
    run('coll:vqb')
    expect(openCollectionTab).not.toHaveBeenCalled()
    expect(vqbOpen.value).toBe(false)
    expect(showToast).toHaveBeenCalledWith('Open a collection first')
  })
})

// #258: a file action must reach the dialog the file was picked in, not one reopened on
// whatever database the tab or sidebar names.
describe('GridFS file actions', () => {
  it.each(['gridfs:view_file', 'gridfs:rename', 'gridfs:meta', 'gridfs:save', 'gridfs:remove'])(
    '%s signals the open dialog without resolving a database', (id) => {
      openModals.gridfs = { resource: db('c1', 'shop') }
      select(db('c1', 'other'))
      run(id)
      expect(openModal).not.toHaveBeenCalled()
      expect(openModals.gridfs).toEqual({ resource: db('c1', 'shop') })
      expect(gridfsMenuRequest.value).toMatchObject({ action: id })
    })

  // #288: AppModals keys each dialog on its payload, so the request must travel through
  // the menu-request store. A payload that grew a request would remount the dialog and
  // lose the file the action was aimed at.
  it.each(['gridfs:view_file', 'gridfs:add'])('%s leaves the dialog payload untouched', async (id) => {
    openModals.gridfs = { resource: db('c1', 'other') }
    select(db('c1', 'other'))
    run(id)
    await nextTick()
    expect(gridfsMenuRequest.value).toMatchObject({ action: id })
    expect(openModals.gridfs).toEqual({ resource: db('c1', 'other') })
  })

  it('bucket actions still resolve their database', () => {
    openModals.gridfs = { resource: db('c1', 'shop') }
    select(db('c1', 'other'))
    run('gridfs:add')
    expect(openModal).toHaveBeenCalledWith('gridfs', { resource: db('c1', 'other'), connectionName: 'Local' })
  })

  // With a collection selected in the sidebar, the menu resolves to that collection;
  // GridFS belongs to its database.
  it('opens on the database of a resolved collection', () => {
    select(coll('c1', 'shop', 'orders'))
    run('gridfs:add')
    expect(openModal).toHaveBeenCalledWith('gridfs', { resource: db('c1', 'shop'), connectionName: 'Local' })
  })

  it('keeps the open dialog when it already shows the resolved database', () => {
    openModals.gridfs = { resource: db('c1', 'other') }
    select(db('c1', 'other'))
    run('gridfs:add')
    expect(openModal).not.toHaveBeenCalled()
  })
})
