import { beforeEach, describe, expect, it } from 'vitest'
import { clipboardQuery, copyQuery, pasteQuery } from './queryClipboard'

beforeEach(() => { clipboardQuery.value = null })

describe('copyQuery', () => {
  it('snapshots every query field, filling gaps with the defaults a fresh tab has', () => {
    copyQuery({ filter: '{ a: 1 }', sort: '{ _id: -1 }', skip: 10 })
    expect(clipboardQuery.value).toEqual({
      mode: 'find', filter: '{ a: 1 }', sort: '{ _id: -1 }', projection: '',
      skip: 10, limit: 50, pipeline: '',
    })
  })

  it('is a copy, not a reference to the tab', () => {
    const tab = { filter: '{ a: 1 }' }
    copyQuery(tab)
    tab.filter = '{ b: 2 }'
    expect(clipboardQuery.value.filter).toBe('{ a: 1 }')
  })
})

describe('pasteQuery', () => {
  it('does nothing and reports so when nothing has been copied', () => {
    const tab = { filter: 'keep' }
    expect(pasteQuery(tab)).toBe(false)
    expect(tab.filter).toBe('keep')
  })

  it('writes every field back onto the tab, numbers coerced', () => {
    clipboardQuery.value = { mode: 'find', filter: '{ a: 1 }', sort: '', projection: '{ a: 1 }', skip: '5', limit: '20', pipeline: '' }
    const tab = { mode: 'find', filter: 'old' }
    expect(pasteQuery(tab)).toBe(true)
    expect(tab).toMatchObject({ filter: '{ a: 1 }', projection: '{ a: 1 }', skip: 5, limit: 20 })
  })

  // Mode goes through the shared switcher so a find tab becomes a proper aggregate tab.
  it('switches the tab into the copied mode', () => {
    clipboardQuery.value = { mode: 'aggregate', filter: '', sort: '', projection: '', skip: 0, limit: 50, pipeline: '[{ $match: {} }]' }
    const tab = { mode: 'find', kind: 'collection' }
    pasteQuery(tab)
    expect(tab.mode).toBe('aggregate')
    expect(tab.pipeline).toBe('[{ $match: {} }]')
  })
})
