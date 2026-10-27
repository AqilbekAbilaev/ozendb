import { describe, it, expect } from 'vitest'
import { nodeTagKey, nodeTagName, pgRowColorName, pgTagKey, tabColorName } from './tabColor.js'
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
  const pg = (...names) => createResourceRef('p1', names.map((name, i) => ({ kind: ['database', 'schema', 'table'][i], name })))
  // What the tab bar passes for a PostgreSQL and a MongoDB collection tab: the levels its
  // workspace definition declares and its engine's tag key.
  const pgColor = (tab, overrides) => tabColorName(tab, overrides, ['table', 'schema', 'database', 'connection'], pgTagKey)
  const collectionColor = (tab, overrides) => tabColorName(tab, overrides, ['collection', 'database', 'connection'], nodeTagKey)

  it('gives each PostgreSQL tab its deepest coloured level: table, schema, database, connection', () => {
    const table = { type: 'postgresql.table_browse', target: pg('pay', 'public', 't') }
    const search = { type: 'postgresql.search', target: pg('pay', 'public') }
    const query = { type: 'postgresql.query', target: pg('pay') }
    const overrides = { p1: 'purple', 'p1/pay': 'blue', 'p1/pay/public': 'green', 'p1/pay/public/t': 'red' }
    expect(pgColor(table, overrides)).toBe('red')
    expect(pgColor(search, overrides)).toBe('green')
    expect(pgColor(query, overrides)).toBe('blue')
    delete overrides['p1/pay/public/t']
    expect(pgColor(table, overrides)).toBe('green')
    delete overrides['p1/pay/public']
    expect(pgColor(search, overrides)).toBe('blue')
    delete overrides['p1/pay']
    expect(pgColor(table, overrides)).toBe('purple')
  })

  it('reads a PostgreSQL tab\'s colour under the key its row saves it as', () => {
    const tab = { type: 'postgresql.table_browse', target: pg('pay', 'a/b', 'c') }
    expect(pgColor(tab, { [pgTagKey(pg('pay', 'a/b', 'c'))]: 'red' })).toBe('red')
    expect(pgColor(tab, { [pgTagKey(pg('pay', 'a', 'b/c'))]: 'red' })).toBe(null)
  })

  it('gives a PostgreSQL table or SQL tab its connection\'s colour', () => {
    const overrides = { p1: 'purple' }
    const table = createResourceRef('p1', [{ kind: 'database', name: 'payments' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 't' }])
    expect(pgColor({ type: 'postgresql.table_browse', target: table }, overrides)).toBe('purple')
    expect(pgColor({ type: 'postgresql.query', target: createResourceRef('p1', [{ kind: 'database', name: 'payments' }]) }, overrides)).toBe('purple')
  })

  it('lets a tab\'s own colour win over its connection\'s', () => {
    expect(pgColor({ type: 'postgresql.table_browse', connectionId: 'p1', color: 'red' }, { p1: 'purple' })).toBe('red')
  })

  it('keeps MongoDB\'s nearest-coloured-ancestor rule', () => {
    const tab = { type: 'mongodb.find', target: createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]) }
    expect(collectionColor(tab, { c1: 'green', 'c1/shop': 'blue' })).toBe('blue')
    expect(collectionColor(tab, { c1: 'green' })).toBe('green')
  })

  it('gives a tab with no levels only its own colour, without needing a key format', () => {
    const tab = { type: 'mysql.query', target: createResourceRef('m1', [{ kind: 'database', name: 'shop' }]) }
    expect(tabColorName(tab, { m1: 'green', 'm1/shop': 'blue' }, [])).toBe(null)
    expect(tabColorName({ ...tab, color: 'red' }, { m1: 'green' }, [])).toBe('red')
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

describe('pgTagKey', () => {
  // Saved to disk and synced, so this format must never change.
  it('joins the connection id and each percent-encoded name below it', () => {
    expect(pgTagKey(createResourceRef('p1'))).toBe('p1')
    expect(pgTagKey(createResourceRef('p1', [
      { kind: 'database', name: 'pay' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'users' },
    ]))).toBe('p1/pay/public/users')
    expect(pgTagKey(createResourceRef('p1', [
      { kind: 'database', name: 'pay' }, { kind: 'schema', name: 'a/b' }, { kind: 'table', name: '50% off' },
    ]))).toBe('p1/pay/a%2Fb/50%25%20off')
  })

  it('never gives two different rows one key', () => {
    const key = (...names) => pgTagKey(createResourceRef('p1', names.map((name, i) => ({ kind: ['database', 'schema', 'table'][i], name }))))
    expect(key('db', 'a', 'b/c')).not.toBe(key('db', 'a/b', 'c'))
    expect(key('db', 'a/b')).not.toBe(key('db', 'a', 'b'))
  })
})

describe('pgRowColorName', () => {
  const pg = (...names) => createResourceRef('p1', names.map((name, i) => ({ kind: ['database', 'schema', 'table'][i], name })))

  it('shows a row\'s own colour, else its schema\'s, its database\'s, then its connection\'s', () => {
    const overrides = { p1: 'purple', 'p1/pay': 'blue', 'p1/pay/public': 'green', 'p1/pay/public/t': 'red' }
    expect(pgRowColorName(overrides, pg('pay', 'public', 't'))).toBe('red')
    expect(pgRowColorName(overrides, pg('pay', 'public', 'other'))).toBe('green')
    expect(pgRowColorName(overrides, pg('pay', 'other', 't'))).toBe('blue')
    expect(pgRowColorName({ p1: 'purple' }, pg('pay', 'public', 't'))).toBe('purple')
  })

  it('falls back to the connection\'s own tag, and shows nothing when none is set', () => {
    expect(pgRowColorName({}, pg('pay', 'public'), 'orange')).toBe('orange')
    expect(pgRowColorName({ 'p1/pay': 'none' }, pg('pay'))).toBe(null)
  })
})
