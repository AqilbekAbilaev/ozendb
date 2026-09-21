import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast, showToast, TOAST_MS } from './toast'

beforeEach(() => { vi.useFakeTimers(); toast.value = null })
afterEach(() => vi.useRealTimers())

it('shows a message and clears it after the timeout', () => {
  showToast('Saved.')
  expect(toast.value).toBe('Saved.')
  vi.advanceTimersByTime(TOAST_MS)
  expect(toast.value).toBeNull()
})

// A second message must get the full display time, not the tail of the first one's.
it('restarts the timer when a message replaces another', () => {
  showToast('first')
  vi.advanceTimersByTime(TOAST_MS - 100)
  showToast('second')
  vi.advanceTimersByTime(200)
  expect(toast.value).toBe('second')
  vi.advanceTimersByTime(TOAST_MS)
  expect(toast.value).toBeNull()
})
