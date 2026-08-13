import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, effectScope, nextTick } from 'vue'
import { useTicker } from './useTicker'

// A timer left running is invisible until it isn't: it re-renders on every tick for
// the rest of the session and keeps its scope alive. These pin that the interval
// exists only while something is actually being timed.

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function run(fn) {
  const scope = effectScope()
  const out = scope.run(fn)
  return { out: out, scope: scope }
}

describe('useTicker', () => {
  it('advances while active', async () => {
    const active = ref(true)
    const { out: now } = run(() => useTicker(active, 100))
    const first = now.value

    await vi.advanceTimersByTimeAsync(250)

    expect(now.value).toBeGreaterThan(first)
  })

  it('stays still while inactive', async () => {
    const active = ref(false)
    const { out: now } = run(() => useTicker(active, 100))
    const first = now.value

    await vi.advanceTimersByTimeAsync(250)

    expect(now.value).toBe(first)
  })

  it('stops when it goes inactive', async () => {
    const active = ref(true)
    const { out: now } = run(() => useTicker(active, 100))

    await vi.advanceTimersByTimeAsync(250)
    active.value = false
    await nextTick()
    const stopped = now.value
    await vi.advanceTimersByTimeAsync(500)

    expect(now.value).toBe(stopped)
  })

  // The Current Operations tab picks its own poll frequency, so the interval has to be
  // able to change under a running ticker.
  it('re-arms when a reactive interval changes', async () => {
    const every = ref(1000)
    const { out: now } = run(() => useTicker(ref(true), every))

    await vi.advanceTimersByTimeAsync(500)
    const beforeChange = now.value
    every.value = 100
    await nextTick()
    await vi.advanceTimersByTimeAsync(150)

    expect(now.value).toBeGreaterThan(beforeChange)
  })

  it('stops when its scope is disposed', async () => {
    const active = ref(true)
    const { out: now, scope } = run(() => useTicker(active, 100))

    await vi.advanceTimersByTimeAsync(250)
    scope.stop()
    const stopped = now.value
    await vi.advanceTimersByTimeAsync(500)

    expect(now.value).toBe(stopped)
  })
})
