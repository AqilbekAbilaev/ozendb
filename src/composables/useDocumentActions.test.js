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
  state: { query: {} },
  runtime: { results: [], selectedRow: -1, selectedRows: [], selectedField: null, isRunning: false },
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
      docMenuRequest: ref(null),
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

// The collection workspace loads on first use, so a native-menu action that opens the
// tab sends its request before any results panel is listening.
describe('a Document/Collection menu request', () => {
  const panel = (docMenuRequest) => useDocumentActions({
    activeTab: () => collectionTab('c1', 'people'),
    docMenuRequest,
    viewMode: ref('table'),
    showToast: vi.fn(),
    requery: vi.fn(),
  })

  it('runs when it arrived before the panel mounted', () => {
    const request = ref({ action: 'coll:update_dialog', nonce: 1 })
    expect(panel(request).showUpdateDialog.value).toBe(true)
  })

  it('runs once: the next panel to mount does not replay it', () => {
    const request = ref({ action: 'coll:update_dialog', nonce: 1 })
    panel(request)
    expect(panel(request).showUpdateDialog.value).toBe(false)
  })
})
