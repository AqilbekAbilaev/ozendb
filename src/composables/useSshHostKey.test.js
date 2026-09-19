import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('vue', async importOriginal => ({
  ...await importOriginal(),
  onMounted: vi.fn(),
  onUnmounted: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../appApi/sshTrust', () => ({ respondSshHostKey: vi.fn(), forgetSshHost: vi.fn() }))

import { onMounted, onUnmounted } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useSshHostKey } from './useSshHostKey'

const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => vi.resetAllMocks())

it('routes each backend event into its own ref', () => {
  const handlers = {}
  listen.mockImplementation((name, fn) => { handlers[name] = fn; return Promise.resolve(vi.fn()) })
  const api = useSshHostKey()
  onMounted.mock.calls.at(-1)[0]()

  handlers['ssh-host-key-prompt']({ payload: { requestId: 'r1', host: 'h' } })
  handlers['ssh-host-key-changed']({ payload: { host: 'h', storedFingerprint: 'a' } })
  expect(api.sshHostKeyPrompt.value).toEqual({ requestId: 'r1', host: 'h' })
  expect(api.sshHostKeyChanged.value).toEqual({ host: 'h', storedFingerprint: 'a' })
})

// A dropped handle leaves one live listener per mount, each writing into a dead ref.
it('unlistens from both events on unmount', async () => {
  const offs = [vi.fn(), vi.fn()]
  listen.mockResolvedValueOnce(offs[0]).mockResolvedValueOnce(offs[1])
  useSshHostKey()
  onMounted.mock.calls.at(-1)[0]()
  expect(listen).toHaveBeenCalledTimes(2)

  onUnmounted.mock.calls.at(-1)[0]()
  await flush()
  for (const off of offs) expect(off).toHaveBeenCalledTimes(1)
})
