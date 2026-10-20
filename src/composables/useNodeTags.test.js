import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../appApi/connections', () => ({ listConnections: vi.fn() }))
vi.mock('../appApi/tags', () => ({
  getNodeTags: vi.fn(),
  setConnectionTag: vi.fn(),
  setNodeTag: vi.fn(),
  clearNodeTagsUnder: vi.fn(),
}))

const { useNodeTags } = await import('./useNodeTags')
const { createResourceRef } = await import('../utils/resourceRef')
const { tagOverrides } = await import('../stores/nodeTags')
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
    tagOverrides.value = { existing: 'blue' }
    tagsApi.setNodeTag.mockRejectedValue(new Error('disk full'))

    await expect(tags.applyColorTag({
      type: 'collection',
      nodeData: { resource: createResourceRef('c1', [{ kind: 'database', name: 'db' }, { kind: 'collection', name: 'orders' }]) },
      color: 'red',
    })).rejects.toThrow('disk full')

    expect(tagOverrides.value).toEqual({ existing: 'blue' })
  })

  it('reflects the persisted parent but keeps descendants when their clear fails', async () => {
    const tags = useNodeTags()
    tagOverrides.value = { 'c1/db': 'green' }
    tagsApi.clearNodeTagsUnder.mockRejectedValue(new Error('write failed'))

    await expect(tags.applyColorTag({
      type: 'connection', nodeData: { resource: createResourceRef('c1') }, color: 'red',
    })).rejects.toThrow('write failed')

    expect(tagOverrides.value).toEqual({ c1: 'red', 'c1/db': 'green' })
  })

  it('updates local tags only after persistence succeeds', async () => {
    const tags = useNodeTags()
    tagOverrides.value = { 'c1/db': 'green', c2: 'blue' }

    await tags.applyColorTag({
      type: 'connection', nodeData: { resource: createResourceRef('c1') }, color: 'red',
    })

    expect(tagOverrides.value).toEqual({ c1: 'red', c2: 'blue' })
  })

  it('serializes rapid changes so the final persisted color wins locally', async () => {
    const tags = useNodeTags()
    let releaseFirst
    tagsApi.setConnectionTag
      .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve }))
      .mockResolvedValueOnce(undefined)

    const first = tags.applyColorTag({
      type: 'connection', nodeData: { resource: createResourceRef('c1') }, color: 'red',
    })
    const second = tags.applyColorTag({
      type: 'connection', nodeData: { resource: createResourceRef('c1') }, color: 'blue',
    })
    await vi.waitFor(() => expect(tagsApi.setConnectionTag).toHaveBeenCalledTimes(1))
    releaseFirst()
    await Promise.all([first, second])

    expect(tagsApi.setConnectionTag.mock.calls.map(([, color]) => color)).toEqual(['red', 'blue'])
    expect(tagOverrides.value.c1).toBe('blue')
  })

  const pg = (...names) => createResourceRef('p1', names.map((name, i) => ({ kind: ['database', 'schema', 'table'][i], name })))

  it('saves a PostgreSQL table\'s colour under its own key and leaves its siblings', async () => {
    const tags = useNodeTags()
    tagOverrides.value = { 'p1/db/public/other': 'green' }

    await tags.applyColorTag({ type: 'pg:table', nodeData: { resource: pg('db', 'public', 'a/b') }, color: 'red' })

    expect(tagsApi.setNodeTag).toHaveBeenCalledWith('p1/db/public/a%2Fb', 'red')
    expect(tagsApi.clearNodeTagsUnder).not.toHaveBeenCalled()
    expect(tagOverrides.value).toEqual({ 'p1/db/public/other': 'green', 'p1/db/public/a%2Fb': 'red' })
  })

  it('resets the colours under a PostgreSQL schema or database, and only those', async () => {
    const tags = useNodeTags()
    tagOverrides.value = { 'p1/db/public/t': 'green', 'p1/db/public2/t': 'blue' }

    await tags.applyColorTag({ type: 'pg:schema', nodeData: { resource: pg('db', 'public') }, color: 'red' })
    expect(tagsApi.clearNodeTagsUnder).toHaveBeenLastCalledWith('p1/db/public/')
    expect(tagOverrides.value).toEqual({ 'p1/db/public': 'red', 'p1/db/public2/t': 'blue' })

    await tags.applyColorTag({ type: 'pg:database', nodeData: { resource: pg('db') }, color: 'purple' })
    expect(tagsApi.clearNodeTagsUnder).toHaveBeenLastCalledWith('p1/db/')
    expect(tagOverrides.value).toEqual({ 'p1/db': 'purple' })
  })
})
