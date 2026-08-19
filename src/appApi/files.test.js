import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { stageImportText, readShellScript, writeShellScript } from './files'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('stageImportText', () => {
  it('passes the content and format through to stage_import_text', async () => {
    invoke.mockResolvedValue('/tmp/staged.json')
    await stageImportText('{ "a": 1 }', 'json')
    expect(invoke).toHaveBeenCalledWith('stage_import_text', { content: '{ "a": 1 }', format: 'json' })
  })
})

describe('readShellScript', () => {
  it('passes the path through to read_shell_script', async () => {
    invoke.mockResolvedValue('print("hi")')
    await readShellScript('/tmp/script.js')
    expect(invoke).toHaveBeenCalledWith('read_shell_script', { path: '/tmp/script.js' })
  })
})

describe('writeShellScript', () => {
  it('passes the path and contents through to write_shell_script', async () => {
    invoke.mockResolvedValue(null)
    await writeShellScript('/tmp/script.js', 'print("hi")')
    expect(invoke).toHaveBeenCalledWith('write_shell_script', { path: '/tmp/script.js', contents: 'print("hi")' })
  })
})