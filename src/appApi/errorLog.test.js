import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { listErrorLog, getErrorReportContext, clearErrorLog, recordFrontendError } from './errorLog'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listErrorLog', () => {
  it('invokes list_error_log without arguments', async () => {
    invoke.mockResolvedValue([])
    await listErrorLog()
    expect(invoke).toHaveBeenCalledWith('list_error_log')
  })
})

describe('getErrorReportContext', () => {
  it('invokes error_report_context without arguments', async () => {
    invoke.mockResolvedValue({})
    await getErrorReportContext()
    expect(invoke).toHaveBeenCalledWith('error_report_context')
  })
})

describe('clearErrorLog', () => {
  it('invokes clear_error_log without arguments', async () => {
    invoke.mockResolvedValue(null)
    await clearErrorLog()
    expect(invoke).toHaveBeenCalledWith('clear_error_log')
  })
})

describe('recordFrontendError', () => {
  it('passes the message through to record_frontend_error', async () => {
    invoke.mockResolvedValue(null)
    await recordFrontendError('boom')
    expect(invoke).toHaveBeenCalledWith('record_frontend_error', { message: 'boom' })
  })
})