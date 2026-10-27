import { describe, it, expect } from 'vitest'
import { bucketChoices, metadataEjson, fmtUploadDate } from './gridfs'

describe('bucketChoices', () => {
  it('always offers the default fs bucket, sorted with the rest', () => {
    expect(bucketChoices([])).toEqual(['fs'])
    expect(bucketChoices(['videos', 'avatars'])).toEqual(['avatars', 'fs', 'videos'])
    expect(bucketChoices(['fs', 'logs'])).toEqual(['fs', 'logs'])
  })
})

describe('metadataEjson', () => {
  it('reads empty text or an empty document as clearing the metadata', () => {
    expect(metadataEjson('')).toEqual({ ok: true, ejson: '' })
    expect(metadataEjson('  {}  ')).toEqual({ ok: true, ejson: '' })
  })

  it('turns a document into canonical Extended JSON', () => {
    const result = metadataEjson('{ author: "ann", tags: ["a"] }')
    expect(result.ok).toBe(true)
    expect(JSON.parse(result.ejson)).toEqual({ author: 'ann', tags: ['a'] })
  })

  it('refuses text that is not a document', () => {
    const result = metadataEjson('[1, 2]')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('fmtUploadDate', () => {
  it('shows the date and time without the fraction or zone', () => {
    expect(fmtUploadDate('2026-10-05T21:44:49.123Z')).toBe('2026-10-05 21:44:49')
  })

  it('shows a dash when the server sent no date', () => {
    expect(fmtUploadDate(null)).toBe('—')
    expect(fmtUploadDate('')).toBe('—')
  })
})
