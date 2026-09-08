import { beforeEach, describe, expect, it, vi } from 'vitest'

const listDatabases = vi.fn()

vi.mock('../engines/mongodb/api/resources', () => ({ listDatabases }))

const {
  connDatabases,
  connectionResourceErrors,
  connectionResourceLoading,
  clearConnectionResources,
  ensureConnectionResources,
  hasLoadedData,
  invalidateConnectionResources,
  refreshConnectionResources,
} = await import('./connectionData')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  for (const id of ['a', 'b']) clearConnectionResources(id)
  connDatabases.value = {}
  connectionResourceLoading.value = {}
  connectionResourceErrors.value = {}
  vi.resetAllMocks()
})

describe('connection resource state', () => {
  it('starts empty and reports no loaded connections', () => {
    expect(connDatabases.value).toEqual({})
    expect(connectionResourceLoading.value).toEqual({})
    expect(connectionResourceErrors.value).toEqual({})
    expect(hasLoadedData('a')).toBe(false)
  })

  it('ensures an unloaded connection once and reuses cached data', async () => {
    const databases = [{ name: 'db' }]
    listDatabases.mockResolvedValue(databases)

    await expect(ensureConnectionResources('a')).resolves.toEqual(databases)
    await expect(ensureConnectionResources('a')).resolves.toEqual(databases)

    expect(listDatabases).toHaveBeenCalledOnce()
    expect(hasLoadedData('a')).toBe(true)
  })

  it('treats an empty database list as loaded', async () => {
    listDatabases.mockResolvedValue([])

    await ensureConnectionResources('a')
    await ensureConnectionResources('a')

    expect(listDatabases).toHaveBeenCalledOnce()
    expect(hasLoadedData('a')).toBe(true)
  })

  it('forces a fresh request on refresh', async () => {
    listDatabases.mockResolvedValueOnce([{ name: 'old' }]).mockResolvedValueOnce([{ name: 'new' }])
    await ensureConnectionResources('a')

    await refreshConnectionResources('a')

    expect(listDatabases).toHaveBeenCalledTimes(2)
    expect(connDatabases.value.a).toEqual([{ name: 'new' }])
  })

  it('shares an in-flight ensure request', async () => {
    const pending = deferred()
    listDatabases.mockReturnValueOnce(pending.promise)
    const first = ensureConnectionResources('a')
    const second = ensureConnectionResources('a')
    expect(second).toBe(first)
    expect(listDatabases).toHaveBeenCalledOnce()
    pending.resolve([])
    await first
  })

  it('retries stale cached data after an invalidation refresh fails', async () => {
    listDatabases.mockResolvedValueOnce([{ name: 'old' }])
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce([{ name: 'new' }])
    await ensureConnectionResources('a')
    invalidateConnectionResources('a')
    await vi.waitFor(() => expect(connectionResourceLoading.value.a).toBe(false))

    await expect(ensureConnectionResources('a')).resolves.toEqual([{ name: 'new' }])
    expect(listDatabases).toHaveBeenCalledTimes(3)
  })

  it('tracks loading and errors independently per connection', async () => {
    const pending = deferred()
    listDatabases.mockImplementation(id => id === 'a' ? pending.promise : Promise.reject(new Error('failed')))

    const requestA = refreshConnectionResources('a')
    const requestB = refreshConnectionResources('b')
    expect(connectionResourceLoading.value).toEqual({ a: true, b: true })

    await expect(requestB).rejects.toThrow('failed')
    expect(connectionResourceLoading.value.a).toBe(true)
    expect(connectionResourceLoading.value.b).toBe(false)
    expect(connectionResourceErrors.value.b.message).toBe('failed')

    pending.resolve([{ name: 'db' }])
    await requestA
    expect(connectionResourceLoading.value.a).toBe(false)
    expect(connectionResourceErrors.value.a).toBeUndefined()
  })

  it('clears an earlier error after a successful request', async () => {
    listDatabases.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce([])
    await expect(refreshConnectionResources('a')).rejects.toThrow('failed')

    await refreshConnectionResources('a')

    expect(connectionResourceErrors.value.a).toBeUndefined()
  })

  it('leaves unloaded invalidation unloaded', () => {
    invalidateConnectionResources('a')

    expect(listDatabases).not.toHaveBeenCalled()
    expect(hasLoadedData('a')).toBe(false)
  })

  it('refreshes loaded invalidation in the background', async () => {
    listDatabases.mockResolvedValueOnce([{ name: 'old' }]).mockResolvedValueOnce([{ name: 'new' }])
    await ensureConnectionResources('a')

    invalidateConnectionResources('a')
    await vi.waitFor(() => expect(connDatabases.value.a).toEqual([{ name: 'new' }]))

    expect(listDatabases).toHaveBeenCalledTimes(2)
  })

  it('contains background refresh rejection', async () => {
    listDatabases.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('refresh failed'))
    await ensureConnectionResources('a')

    invalidateConnectionResources('a')
    await vi.waitFor(() => expect(connectionResourceLoading.value.a).toBe(false))

    expect(connectionResourceErrors.value.a.message).toBe('refresh failed')
  })

  it('ignores a stale response after invalidation', async () => {
    const oldRequest = deferred()
    const newRequest = deferred()
    listDatabases.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)

    const first = refreshConnectionResources('a')
    invalidateConnectionResources('a')
    newRequest.resolve([{ name: 'new' }])
    await vi.waitFor(() => expect(connDatabases.value.a).toEqual([{ name: 'new' }]))
    oldRequest.resolve([{ name: 'old' }])
    await first

    expect(connDatabases.value.a).toEqual([{ name: 'new' }])
  })

  it('ignores a stale response after clear', async () => {
    const pending = deferred()
    listDatabases.mockReturnValue(pending.promise)
    const request = refreshConnectionResources('a')

    clearConnectionResources('a')
    pending.resolve([{ name: 'late' }])
    await request

    expect(hasLoadedData('a')).toBe(false)
    expect(connectionResourceLoading.value.a).toBeUndefined()
  })

  it('keeps only the newest response after repeated active invalidation', async () => {
    const first = deferred()
    const second = deferred()
    const third = deferred()
    listDatabases.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)

    const initialRequest = refreshConnectionResources('a')
    invalidateConnectionResources('a')
    invalidateConnectionResources('a')
    third.resolve([{ name: 'latest' }])
    await vi.waitFor(() => expect(connDatabases.value.a).toEqual([{ name: 'latest' }]))
    second.resolve([{ name: 'middle' }])
    first.resolve([{ name: 'first' }])
    await initialRequest

    expect(connDatabases.value.a).toEqual([{ name: 'latest' }])
  })
})
