import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  runShellCommand,
  closeShellSession,
  getShellHistory,
  pushShellCommand,
  clearShellHistory,
} from './shell'

const session = { connectionId: 'connection-1', database: 'app', sessionId: 'session-1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runShellCommand', () => {
  it('translates the session and code into the run_shell_command payload', async () => {
    invoke.mockResolvedValue({ output: '' })
    await runShellCommand(session, 'db.users.find()')
    expect(invoke).toHaveBeenCalledWith('run_shell_command', {
      id:        'connection-1',
      database:  'app',
      sessionId: 'session-1',
      code:      'db.users.find()',
    })
  })
})

describe('closeShellSession', () => {
  it('translates the session id into the close_shell_session payload', async () => {
    invoke.mockResolvedValue(null)
    await closeShellSession('session-1')
    expect(invoke).toHaveBeenCalledWith('close_shell_session', { sessionId: 'session-1' })
  })
})

describe('getShellHistory', () => {
  it('translates the connection id into the get_shell_history payload', async () => {
    invoke.mockResolvedValue([])
    await getShellHistory('connection-1')
    expect(invoke).toHaveBeenCalledWith('get_shell_history', { connectionId: 'connection-1' })
  })
})

describe('pushShellCommand', () => {
  it('translates the connection id and command into the push_shell_command payload', async () => {
    invoke.mockResolvedValue(null)
    await pushShellCommand('connection-1', 'db.users.find()')
    expect(invoke).toHaveBeenCalledWith('push_shell_command', {
      connectionId: 'connection-1',
      command:      'db.users.find()',
    })
  })
})

describe('clearShellHistory', () => {
  it('translates the connection id into the clear_shell_history payload', async () => {
    invoke.mockResolvedValue(null)
    await clearShellHistory('connection-1')
    expect(invoke).toHaveBeenCalledWith('clear_shell_history', { connectionId: 'connection-1' })
  })
})