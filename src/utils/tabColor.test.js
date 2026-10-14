import { describe, it, expect } from 'vitest'
import { nodeTagKey, nodeTagName, tabColorName } from './tabColor.js'
import { createResourceRef } from './resourceRef.js'

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
    const table = createResourceRef('p1', [{ kind: 'database', name: 'payments' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 't' }])
    expect(tabColorName({ type: 'postgresql.table_browse', target: table }, overrides)).toBe('purple')
    expect(tabColorName({ type: 'postgresql.query', target: createResourceRef('p1', [{ kind: 'database', name: 'payments' }]) }, overrides)).toBe('purple')
  })

  it('lets a tab\'s own colour win over its connection\'s', () => {
    expect(tabColorName({ type: 'postgresql.table_browse', connectionId: 'p1', color: 'red' }, { p1: 'purple' })).toBe('red')
  })

  it('keeps MongoDB\'s nearest-coloured-ancestor rule', () => {
    const tab = { type: 'mongodb.find', target: createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]) }
    expect(tabColorName(tab, { c1: 'green', 'c1/shop': 'blue' })).toBe('blue')
    expect(tabColorName(tab, { c1: 'green' })).toBe('green')
  })
})

describe('nodeTagKey', () => {
  it('joins the connection id and the names below it, as the tag store keys them', () => {
    expect(nodeTagKey(createResourceRef('c1'))).toBe('c1')
    expect(nodeTagKey(createResourceRef('c1', [{ kind: 'database', name: 'shop' }]))).toBe('c1/shop')
    expect(nodeTagKey(createResourceRef('c1', [
      { kind: 'database', name: 'shop' }, { kind: 'collection', name: 'a/b' },
    ]))).toBe('c1/shop/a/b')
  })
})
