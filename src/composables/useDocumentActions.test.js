import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'

vi.mock('../engines/mongodb/api/documents', () => ({
  deleteDocument: vi.fn(),
  deleteMany: vi.fn(),
  insertDocuments: vi.fn(),
  replaceDocument: vi.fn(),
  clearCollection: vi.fn(),
  openDocumentWindow: vi.fn(),
}))

import { insertDocuments } from '../engines/mongodb/api/documents'
import { useDocumentActions } from './useDocumentActions'

const collectionTab = (connectionId, collectionName) => reactive({
  id: collectionName,
  kind: 'collection',
  connectionId,
  dbName: 'shop',
  collectionName,
  results: [],
  selectedRow: -1,
  selectedRows: [],
  selectedField: null,
  isRunning: false,
})

describe('Paste Documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('navigator', {
      clipboard: { readText: vi.fn().mockResolvedValue('[{ "name": "Ada" }]') },
    })
    vi.mocked(insertDocuments).mockResolvedValue(1)
  })

  it('keeps the canonical collection target captured when the dialog opened', async () => {
    let active = collectionTab('c1', 'people')
    const requery = vi.fn()
    const original = active
    const actions = useDocumentActions({
      activeTab: () => active,
      docMenuRequest: () => null,
      viewMode: ref('table'),
      showToast: vi.fn(),
      requery,
    })

    await actions.pasteDocuments()
    active = collectionTab('c2', 'orders')
    await actions.onPasteConfirm()

    expect(insertDocuments).toHaveBeenCalledWith({
      connectionId: 'c1',
      database: 'shop',
      collection: 'people',
    }, '[{ "name": "Ada" }]')
    expect(requery).toHaveBeenCalledWith(true, original)
  })
})
