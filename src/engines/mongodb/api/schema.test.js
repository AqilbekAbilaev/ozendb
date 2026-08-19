import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { analyzeSchema, exportSchema } from './schema'

const target = { connectionId: 'connection-1', database: 'app', collection: 'users' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('analyzeSchema', () => {
  it('translates the target into the analyze_schema payload with a sample size', async () => {
    invoke.mockResolvedValue({ fields: [] })
    await analyzeSchema(target, 100)
    expect(invoke).toHaveBeenCalledWith('analyze_schema', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      sampleSize: 100,
    })
  })

  it('omits the sample size when not provided', async () => {
    invoke.mockResolvedValue({ fields: [] })
    await analyzeSchema(target)
    expect(invoke).toHaveBeenCalledWith('analyze_schema', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
    })
  })
})

describe('exportSchema', () => {
  it('translates the target, path and format into the export_schema payload', async () => {
    invoke.mockResolvedValue(12)
    await exportSchema(target, 100, '/tmp/schema.json', 'json')
    expect(invoke).toHaveBeenCalledWith('export_schema', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      sampleSize: 100,
      path:       '/tmp/schema.json',
      format:     'json',
    })
  })

  it('resolves with the exported field count unchanged', async () => {
    invoke.mockResolvedValue(12)
    await expect(exportSchema(target, 100, '/tmp/schema.json', 'json')).resolves.toBe(12)
  })
})