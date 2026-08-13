import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { ref, reactive } from 'vue'
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
