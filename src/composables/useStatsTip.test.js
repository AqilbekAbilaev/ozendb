import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
import { invoke } from '@tauri-apps/api/core'
import { useStatsTip, HOVER_DELAY, HOVER_GRACE } from './useStatsTip'

// The hover card exists to answer "how big is this collection?" without opening it.
// Everything worth pinning is timing: a cursor passing over a row must cost nothing,
// and a reply for a row the pointer has already left must never reach the screen.

const AT = { clientX: 240, clientY: 120 }
const TARGET = { connId: 'c1', dbName: 'app', collName: 'users' }
const STATS = { count: 42, size: 4096, avg_obj_size: 97, nindexes: 3 }

// A promise whose resolution the test controls, so a reply can be made to land
// after the pointer has moved on.
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useStatsTip — hover intent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    invoke.mockReset()
    invoke.mockResolvedValue(STATS)
  })
  afterEach(() => vi.useRealTimers())

  it('asks for nothing until the pointer has rested for the delay', () => {
    const { tip, show } = useStatsTip()
    show(AT, TARGET)
    vi.advanceTimersByTime(HOVER_DELAY - 1)
    expect(invoke).not.toHaveBeenCalled()
    expect(tip.value).toBe(null)
  })

  it('a cursor passing over the row costs no round trip', async () => {
    const { tip, show, hide } = useStatsTip()
    show(AT, TARGET)
    vi.advanceTimersByTime(100)
    hide()
    await vi.advanceTimersByTimeAsync(1000)
    expect(invoke).not.toHaveBeenCalled()
    expect(tip.value).toBe(null)
  })

  it('resting on a row opens the card clear of the pointer, then fills in the stats', async () => {
    const { tip, show } = useStatsTip()
    show(AT, TARGET)
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)
    expect(invoke).toHaveBeenCalledWith('collection_stats', {
      id: 'c1', database: 'app', collection: 'users',
    })
    expect(tip.value).toMatchObject({ label: 'app.users', x: 254, y: 112, stats: STATS, error: null })
    expect(tip.value.fetchedAt).toBeTruthy()
  })

  it('reads dbStats for a target with no collection', async () => {
    const DB_STATS = { collections: 12, objects: 5000, dataSize: 4096 }
    invoke.mockResolvedValueOnce(DB_STATS)
    const { tip, show } = useStatsTip()
    show(AT, { connId: 'c1', dbName: 'app' })
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)
    expect(invoke).toHaveBeenCalledWith('database_stats', { id: 'c1', database: 'app' })
    expect(tip.value).toMatchObject({ label: 'app', kind: 'database', stats: DB_STATS })
  })

  it('labels a collection target with its full namespace', async () => {
    const { tip, show } = useStatsTip()
    show(AT, TARGET)
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)
    expect(tip.value.kind).toBe('collection')
    expect(tip.value.label).toBe('app.users')
  })

  it('refresh re-reads the open card in place', async () => {
    const { tip, show, refresh } = useStatsTip()
    show(AT, TARGET)
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)

    invoke.mockResolvedValueOnce({ ...STATS, count: 99 })
    refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(tip.value.stats.count).toBe(99)
    expect(tip.value.label).toBe('app.users')
  })

  it('refresh does nothing with no card open', async () => {
    const { show, hide, refresh } = useStatsTip()
    show(AT, TARGET)
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)
    hide()
    refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('opens beside the pointer, never below it', async () => {
    // The card must be reachable by moving sideways. Put its top below the pointer and
    // the trip crosses the next collection row, which steals the hover on the way.
    const { tip, show } = useStatsTip()
    show(AT, TARGET)
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)
    expect(tip.value.x).toBeGreaterThan(AT.clientX)
    expect(tip.value.y).toBeLessThanOrEqual(AT.clientY)
  })

  it('opens where the pointer came to rest, not where it entered the row', async () => {
    const { tip, show, move } = useStatsTip()
    show(AT, TARGET)
    vi.advanceTimersByTime(100)
    move({ clientX: 300, clientY: 160 })
    await vi.advanceTimersByTimeAsync(HOVER_DELAY - 100)
    expect(tip.value).toMatchObject({ x: 314, y: 152 })
  })

  it('stays put once open — the card must not chase the cursor', async () => {
    const { tip, show, move } = useStatsTip()
    show(AT, TARGET)
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)
    move({ clientX: 900, clientY: 900 })
    expect(tip.value).toMatchObject({ x: 254, y: 112 })
  })

  it('drops a reply for a row the pointer has already left', async () => {
    const slow = deferred()
    invoke.mockReturnValueOnce(slow.promise)
    const { tip, show, hide } = useStatsTip()
    show(AT, TARGET)
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)
    hide()
    slow.resolve(STATS)
    await Promise.resolve()
    expect(tip.value).toBe(null)
  })

  it('does not let a slow reply overwrite the row now hovered', async () => {
    const slow = deferred()
    invoke.mockReturnValueOnce(slow.promise)
    const { tip, show } = useStatsTip()
    show(AT, TARGET)
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)

    invoke.mockResolvedValueOnce({ ...STATS, count: 7 })
    show(AT, { ...TARGET, collName: 'orders' })
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)

    slow.resolve(STATS)
    await Promise.resolve()
    expect(tip.value.label).toBe('app.orders')
    expect(tip.value.stats.count).toBe(7)
  })

  it('survives the trip from the row to the card', async () => {
    const { tip, show, keep, hideSoon } = useStatsTip()
    show(AT, TARGET)
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)

    hideSoon()                      // pointer left the row…
    vi.advanceTimersByTime(100)
    keep()                          // …and landed on the card
    vi.advanceTimersByTime(1000)
    expect(tip.value).not.toBe(null)
  })

  it('closes once the pointer leaves the card', async () => {
    const { tip, show, keep, hideSoon } = useStatsTip()
    show(AT, TARGET)
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)
    hideSoon()
    keep()

    hideSoon()
    vi.advanceTimersByTime(HOVER_GRACE - 1)
    expect(tip.value).not.toBe(null)
    vi.advanceTimersByTime(1)
    expect(tip.value).toBe(null)
  })

  it('leaving before the card opens closes it outright, grace or not', async () => {
    const { tip, show, hideSoon } = useStatsTip()
    show(AT, TARGET)
    vi.advanceTimersByTime(100)
    hideSoon()
    await vi.advanceTimersByTimeAsync(1000)
    expect(invoke).not.toHaveBeenCalled()
    expect(tip.value).toBe(null)
  })

  it('shows the failure in place of the numbers', async () => {
    invoke.mockRejectedValueOnce({ code: 'Mongo', message: 'not authorized' })
    const { tip, show } = useStatsTip()
    show(AT, TARGET)
    await vi.advanceTimersByTimeAsync(HOVER_DELAY)
    expect(tip.value.stats).toBe(null)
    expect(tip.value.error).toBe('not authorized')
  })
})
