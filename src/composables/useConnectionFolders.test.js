import { describe, it, expect, vi, beforeEach } from 'vitest'

// The composable's local `deleteFolder` used to shadow the imported API function
// (same name, different signature): the confirm path recursed into itself and the
// folder never reached the backend. These cases pin the API boundary.
vi.mock('../appApi/folders', () => ({
  listFolders: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveConnectionToFolder: vi.fn(),
}))
vi.mock('../engines/mongodb/api/connections', () => ({
  listConnections: vi.fn(),
}))

const { useConnectionFolders } = await import('./useConnectionFolders')
const api = await import('../appApi/folders')
const connApi = await import('../engines/mongodb/api/connections')

beforeEach(() => {
  vi.clearAllMocks()
})

function harness() {
  const toasts = []
  const connections = { value: [{ id: 'c1', name: 'C1' }] }
  const filtered = { value: [] }
  const fx = useConnectionFolders({
    connections,
    selectedId: { value: null },
    filterText: { value: '' },
    filtered,
    showToast: (m) => toasts.push(m),
  })
  return { fx, toasts, connections }
}

describe('deleteFolder', () => {
  it('reaches the API once after confirming and refreshes the list', async () => {
    const { fx, connections } = harness()
    fx.folders.value = [{ id: 'f1', name: 'Work' }]
    api.deleteFolder.mockResolvedValue(undefined)
    connApi.listConnections.mockResolvedValue([{ id: 'c1', name: 'C1' }])

    await fx.deleteFolder({ id: 'f1' })
    expect(api.deleteFolder).not.toHaveBeenCalled() // first click only arms

    await fx.deleteFolder({ id: 'f1' })

    expect(api.deleteFolder).toHaveBeenCalledTimes(1)
    expect(api.deleteFolder).toHaveBeenCalledWith('f1')
    expect(fx.folders.value).toEqual([])
    expect(connections.value).toHaveLength(1)
  })
})