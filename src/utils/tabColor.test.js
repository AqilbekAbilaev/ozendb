import { describe, it, expect } from 'vitest'
import { nodeTagName, tabColorName } from './tabColor.js'

describe('nodeTagName', () => {
  it('prefers the node\'s override, then its stored tag, and treats none as no colour', () => {
    expect(nodeTagName({ c1: 'green' }, 'c1', 'red')).toBe('green')
    expect(nodeTagName({}, 'c1', 'red')).toBe('red')
    expect(nodeTagName({ c1: 'none' }, 'c1', 'red')).toBe(null)
    expect(nodeTagName({}, 'c1')).toBe(null)
  })
})

describe('tabColorName', () => {
  it('gives a PostgreSQL table or SQL tab its connection\'s colour', () => {
    const overrides = { p1: 'purple' }
    expect(tabColorName({ kind: 'pgTable', connectionId: 'p1', schema: 'public', table: 't' }, overrides)).toBe('purple')
    expect(tabColorName({ kind: 'pgQuery', connectionId: 'p1', database: 'payments' }, overrides)).toBe('purple')
  })

  it('lets a tab\'s own colour win over its connection\'s', () => {
    expect(tabColorName({ kind: 'pgTable', connectionId: 'p1', color: 'red' }, { p1: 'purple' })).toBe('red')
  })

  it('keeps MongoDB\'s nearest-coloured-ancestor rule', () => {
    const tab = { kind: 'collection', connectionId: 'c1', dbName: 'shop', collectionName: 'orders' }
    expect(tabColorName(tab, { c1: 'green', 'c1/shop': 'blue' })).toBe('blue')
    expect(tabColorName(tab, { c1: 'green' })).toBe('green')
  })
})
