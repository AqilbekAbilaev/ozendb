import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { listOperations, clearFinishedOperations } from './operations'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listOperations', () => {
  it('invokes list_operations without arguments', async () => {
    invoke.mockResolvedValue([])
    await listOperations()
    expect(invoke).toHaveBeenCalledWith('list_operations')
  })
})

describe('clearFinishedOperations', () => {
  it('invokes clear_operations without arguments', async () => {
    invoke.mockResolvedValue(null)
    await clearFinishedOperations()
    expect(invoke).toHaveBeenCalledWith('clear_operations')
  })
})