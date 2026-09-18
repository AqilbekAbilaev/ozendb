import { beforeEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../engines/mongodb/api/resources', () => ({ listDatabases: vi.fn() }))
vi.mock('../engines/mongodb/api/transfer', () => ({
  exportCollection: vi.fn(), importCollection: vi.fn(),
  copyCollection: vi.fn(), copyCollectionToConnection: vi.fn(),
}))
vi.mock('../stores/connectionData', () => ({ invalidateConnectionResources: vi.fn() }))
vi.mock('../stores/modals', () => ({ openModal: vi.fn(), closeModal: vi.fn() }))

import { open } from '@tauri-apps/plugin-dialog'
import { listDatabases } from '../engines/mongodb/api/resources'
import { importCollection, copyCollection, copyCollectionToConnection } from '../engines/mongodb/api/transfer'
import { invalidateConnectionResources } from '../stores/connectionData'
import { openModal, closeModal } from '../stores/modals'
import { useDbTransfer } from './useDbTransfer'
import { useDbActions } from './useDbActions'

beforeEach(() => vi.resetAllMocks())
const target = { connId: 'destination', dbName: 'db' }

it('creates an import workspace from the picker target captured at open', () => {
  const openImportTab = vi.fn()
  const transfer = useDbTransfer({ showToast: vi.fn(), openImportTab })
  const target = { connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders' }

  transfer.openImportWizard(target)
  const [, capturedTarget, options] = openModal.mock.calls[0]
  options.on.configure('csv')

  expect(openImportTab).toHaveBeenCalledWith(capturedTarget, 'csv')
  expect(closeModal).toHaveBeenCalledWith('import')
})

it('invalidates a partially successful database import without a tree', async () => {
  open.mockResolvedValue(['/a.json', '/b.csv'])
  importCollection.mockResolvedValueOnce(1).mockRejectedValueOnce('Failed')
  const showToast = vi.fn()
  await useDbTransfer({ showToast }).importDatabase(target)
  expect(invalidateConnectionResources).toHaveBeenCalledWith('destination')
  expect(showToast).toHaveBeenLastCalledWith('Imported 1 file, 1 failed')
})

it('does not invalidate when every import fails', async () => {
  open.mockResolvedValue(['/a.json'])
  importCollection.mockRejectedValue('Failed')
  const showToast = vi.fn()
  await useDbTransfer({ showToast }).importDatabase(target)
  expect(invalidateConnectionResources).not.toHaveBeenCalled()
  expect(showToast).toHaveBeenCalledWith('Imported 0 files, 1 failed')
})

it.each(['destination', 'source'])('invalidates the destination after collection paste from %s', async connId => {
  const showToast = vi.fn()
  const dbClipboard = ref({ kind: 'collection', connId, dbName: 'sourceDb', collName: 'items' })
  await useDbActions({ showToast, dbClipboard }).pasteClipboard(target)
  expect(connId === target.connId ? copyCollection : copyCollectionToConnection).toHaveBeenCalledOnce()
  expect(invalidateConnectionResources).toHaveBeenCalledWith('destination')
  expect(showToast).toHaveBeenCalledTimes(1)
  expect(showToast.mock.calls[0][0]).toContain('Pasted "items"')
})

it('invalidates successful database copies even when later collections fail', async () => {
  listDatabases.mockResolvedValue([{ name: 'sourceDb', collections: ['a', 'b'] }])
  copyCollectionToConnection.mockResolvedValueOnce(1).mockRejectedValueOnce('Failed')
  const showToast = vi.fn()
  const dbClipboard = ref({ kind: 'database', connId: 'source', dbName: 'sourceDb' })
  await useDbActions({ showToast, dbClipboard }).pasteClipboard(target)
  expect(invalidateConnectionResources).toHaveBeenCalledWith('destination')
  expect(showToast).toHaveBeenLastCalledWith('Pasted 1 collection into db (cross-server)')
})
