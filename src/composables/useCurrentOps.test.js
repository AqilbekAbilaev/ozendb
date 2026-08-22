import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { ref, reactive, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useCurrentOps, opsDefaults } from './useCurrentOps'

// Switching workspace tabs unmounts the pane, so anything held in a plain ref inside it
// is gone when the user comes back. The toolbar settings live on the tab object for that
// reason, and one component instance is reused across tabs of the same kind — so the
// settings must follow whichever tab is active, not the one that was active at setup.

// Tabs live in a reactive store array in the app, so a plain object here would let a
// computed over tab state cache forever and hide exactly the bugs these tests look for.
const newTab = (over = {}) => reactive({
  id: 't1', connId: 'c1', connName: 'Local', ...opsDefaults(), ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue({ inprog: [] })
})

describe('toolbar settings', () => {
  it('writes through to the tab, so they survive a tab switch', () => {
    const tab = newTab()
    const { retention, showSys } = useCurrentOps(() => tab)

    retention.value = 0
    showSys.value = true

    expect(tab.retention).toBe(0)
    expect(tab.showSys).toBe(true)
  })

  // `active` stands in for the pane's activeTab prop, which changes under one reused
  // component instance when the user switches between two of these tabs.
  it('reads the tab that is active now, not the one it was created with', () => {
    const active = ref(newTab({ id: 't1', retention: 0 }))
    const { retention } = useCurrentOps(() => active.value)
    expect(retention.value).toBe(0)

    active.value = newTab({ id: 't2', retention: 30_000 })
    expect(retention.value).toBe(30_000)
  })

  it('does not treat a tab switch as a server-filter change', async () => {
    const a = newTab({ id: 'a', ownOnly: false, ops: [{ opid: 1 }] })
    const b = newTab({ id: 'b', ownOnly: true, ops: [{ opid: 2 }] })
    const active = ref(a)
    useCurrentOps(() => active.value)

    active.value = b
    await nextTick()

    expect(b.ops).toEqual([{ opid: 2 }])
  })

  it('asks the server for the ops the filters imply', async () => {
    const tab = newTab({ ownOnly: true, showSys: true })
    const { load } = useCurrentOps(() => tab)

    await load()

    expect(invoke).toHaveBeenCalledWith('current_ops', { id: 'c1', ownOnly: true, all: true })
  })
})

describe('retention', () => {
  const anOp = { opid: 1, connectionId: 9, op: 'query', ns: 'db.c', secs_running: 2 }

  it('keeps a finished op in the grid until its retention elapses', async () => {
    vi.useFakeTimers()
    const tab = newTab({ retention: 10_000, frequency: 0 })
    const { load, visible, retainedCount } = useCurrentOps(() => tab)

    invoke.mockResolvedValue({ inprog: [anOp] })
    await load()
    expect(visible.value).toHaveLength(1)

    // The op finishes: the server stops reporting it.
    invoke.mockResolvedValue({ inprog: [] })
    await load()
    expect(visible.value).toHaveLength(1)
    expect(retainedCount.value).toBe(1)
    expect(tab.results).toHaveLength(1)

    vi.advanceTimersByTime(11_000)
    await load()
    expect(visible.value).toHaveLength(0)
    expect(tab.results).toHaveLength(0)
    vi.useRealTimers()
  })
})

// Watching an operation means leaving this tab — you start the query somewhere else, and
// you cancel it somewhere else. The pane is unmounted for all of that, so its list has to
// live on the tab; otherwise every return starts blank and nothing is ever retained.
describe('across a tab switch', () => {
  const anOp = { opid: 1, connectionId: 9, op: 'query', ns: 'people.docs', secs_running: 4 }

  it('retains an operation that finished while the pane was away', async () => {
    const tab = newTab({ retention: 10_000, frequency: 0 })

    invoke.mockResolvedValue({ inprog: [anOp] })
    await useCurrentOps(() => tab).load()          // pane mounted: the query is running

    // The user leaves for the query tab and cancels it there; the pane is torn down and
    // rebuilt when they come back, and the operation is gone from the server.
    invoke.mockResolvedValue({ inprog: [] })
    const reopened = useCurrentOps(() => tab)
    await reopened.load()

    expect(reopened.visible.value).toHaveLength(1)
    expect(reopened.retainedCount.value).toBe(1)
  })
})

// Current Operations opens as many tabs as you like — two views of one server, watching it
// through different filters. That only holds while no state is shared between them.
describe('two tabs at once', () => {
  it('gives each tab its own operations, filters and column order', async () => {
    const a = newTab({ id: 'a', retention: 0 })
    const b = newTab({ id: 'b' })

    expect(a.ops).not.toBe(b.ops)
    expect(a.colOrder).not.toBe(b.colOrder)

    invoke.mockResolvedValue({ inprog: [{ opid: 7, connectionId: 1, ns: 'db.c' }] })
    await useCurrentOps(() => a).load()

    expect(a.ops).toHaveLength(1)
    expect(b.ops).toHaveLength(0)

    a.slowOnly = true
    expect(b.slowOnly).toBe(false)
  })

  it('keeps overlapping responses on the tabs that requested them', async () => {
    const a = newTab({ id: 'a', connId: 'c1', frequency: 0, retention: 0 })
    const b = newTab({ id: 'b', connId: 'c2', frequency: 0, retention: 0 })
    const active = ref(a)
    let resolveA
    const replyA = new Promise(resolve => { resolveA = resolve })
    invoke
      .mockImplementationOnce(() => replyA)
      .mockResolvedValueOnce({ inprog: [{ opid: 2, connectionId: 2, ns: 'b.items' }] })
    const ops = useCurrentOps(() => active.value)

    const loadA = ops.load()
    expect(a._opsLoading).toBe(true)
    active.value = b
    const loadB = ops.load()
    await loadB
    expect(b._opsLoading).toBe(false)
    expect(a._opsLoading).toBe(true)
    resolveA({ inprog: [{ opid: 1, connectionId: 1, ns: 'a.items' }] })
    await loadA

    expect(a.ops.map(op => op.opid)).toEqual([1])
    expect(b.ops.map(op => op.opid)).toEqual([2])
    expect(a._opsLoading).toBe(false)
    expect(invoke).toHaveBeenCalledWith('current_ops', { id: 'c1', ownOnly: false, all: false })
    expect(invoke).toHaveBeenCalledWith('current_ops', { id: 'c2', ownOnly: false, all: false })
  })

  it('reloads with new server filters when they change during a request', async () => {
    const tab = newTab({ frequency: 0, retention: 0 })
    let resolveInitial
    invoke
      .mockImplementationOnce(() => new Promise(resolve => { resolveInitial = resolve }))
      .mockResolvedValueOnce({ inprog: [{ opid: 2, connectionId: 2, ns: 'db.own' }] })
    const ops = useCurrentOps(() => tab)

    const initial = ops.load()
    ops.ownOnly.value = true
    await nextTick()
    resolveInitial({ inprog: [{ opid: 1, connectionId: 1, ns: 'db.other' }] })
    await initial
    await vi.waitFor(() => expect(tab.ops.map(op => op.opid)).toEqual([2]))

    expect(invoke).toHaveBeenNthCalledWith(1, 'current_ops', { id: 'c1', ownOnly: false, all: false })
    expect(invoke).toHaveBeenNthCalledWith(2, 'current_ops', { id: 'c1', ownOnly: true, all: false })
  })

  it('refreshes the initiating server after a delayed kill', async () => {
    const a = newTab({ id: 'a', connId: 'c1', frequency: 0 })
    const b = newTab({ id: 'b', connId: 'c2', frequency: 0 })
    const active = ref(a)
    let resolveKill
    invoke.mockImplementation((command) => {
      if (command === 'kill_op') return new Promise(resolve => { resolveKill = resolve })
      return Promise.resolve({ inprog: [] })
    })
    const ops = useCurrentOps(() => active.value)

    const killing = ops.kill(7)
    active.value = b
    await vi.waitFor(() => expect(resolveKill).toBeTypeOf('function'))
    resolveKill()
    await killing

    expect(invoke).toHaveBeenCalledWith('kill_op', { id: 'c1', opid: 7 })
    expect(invoke).toHaveBeenCalledWith('current_ops', { id: 'c1', ownOnly: false, all: false })
  })

  it('refreshes again when a pre-kill load was already in flight', async () => {
    const tab = newTab({ frequency: 0, retention: 0 })
    let resolveInitial
    invoke.mockImplementation((command) => {
      if (command === 'kill_op') return Promise.resolve()
      if (!resolveInitial) {
        return new Promise(resolve => { resolveInitial = resolve })
      }
      return Promise.resolve({ inprog: [] })
    })
    const ops = useCurrentOps(() => tab)

    const initial = ops.load()
    const killing = ops.kill(7)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('kill_op', { id: 'c1', opid: 7 }))
    resolveInitial({ inprog: [{ opid: 7, connectionId: 1, ns: 'db.items' }] })
    await Promise.all([initial, killing])

    expect(invoke.mock.calls.filter(([command]) => command === 'current_ops')).toHaveLength(2)
    expect(tab.ops).toEqual([])
  })
})
