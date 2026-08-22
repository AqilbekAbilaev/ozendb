import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../engines/mongodb/api/connections', () => ({ listConnections: vi.fn() }))
vi.mock('../appApi/tags', () => ({
  getNodeTags: vi.fn(),
  setConnectionTag: vi.fn(),
  setNodeTag: vi.fn(),
  clearNodeTagsUnder: vi.fn(),
}))

const { useNodeTags } = await import('./useNodeTags')
const tagsApi = await import('../appApi/tags')

beforeEach(() => {
  vi.clearAllMocks()
  tagsApi.setConnectionTag.mockResolvedValue(undefined)
  tagsApi.setNodeTag.mockResolvedValue(undefined)
  tagsApi.clearNodeTagsUnder.mockResolvedValue(undefined)
})

describe('applyColorTag', () => {
  it('leaves local tags unchanged when the tag write fails', async () => {
    const tags = useNodeTags()
    tags.tagOverrides.value = { existing: 'blue' }
    tagsApi.setNodeTag.mockRejectedValue(new Error('disk full'))

    await expect(tags.applyColorTag({
      type: 'collection',
      nodeData: { connId: 'c1', dbName: 'db', collName: 'orders' },
      color: 'red',
    })).rejects.toThrow('disk full')

    expect(tags.tagOverrides.value).toEqual({ existing: 'blue' })
  })

  it('reflects the persisted parent but keeps descendants when their clear fails', async () => {
    const tags = useNodeTags()
    tags.tagOverrides.value = { 'c1/db': 'green' }
    tagsApi.clearNodeTagsUnder.mockRejectedValue(new Error('write failed'))

    await expect(tags.applyColorTag({
      type: 'connection', nodeData: { connId: 'c1' }, color: 'red',
    })).rejects.toThrow('write failed')

    expect(tags.tagOverrides.value).toEqual({ c1: 'red', 'c1/db': 'green' })
  })

  it('updates local tags only after persistence succeeds', async () => {
    const tags = useNodeTags()
    tags.tagOverrides.value = { 'c1/db': 'green', c2: 'blue' }

    await tags.applyColorTag({
      type: 'connection', nodeData: { connId: 'c1' }, color: 'red',
    })

    expect(tags.tagOverrides.value).toEqual({ c1: 'red', c2: 'blue' })
  })

  it('serializes rapid changes so the final persisted color wins locally', async () => {
    const tags = useNodeTags()
    let releaseFirst
    tagsApi.setConnectionTag
      .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve }))
      .mockResolvedValueOnce(undefined)

    const first = tags.applyColorTag({
      type: 'connection', nodeData: { connId: 'c1' }, color: 'red',
    })
    const second = tags.applyColorTag({
      type: 'connection', nodeData: { connId: 'c1' }, color: 'blue',
    })
    await vi.waitFor(() => expect(tagsApi.setConnectionTag).toHaveBeenCalledTimes(1))
    releaseFirst()
    await Promise.all([first, second])

    expect(tagsApi.setConnectionTag.mock.calls.map(([, color]) => color)).toEqual(['red', 'blue'])
    expect(tags.tagOverrides.value.c1).toBe('blue')
  })
})
