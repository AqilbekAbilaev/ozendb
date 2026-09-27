import { describe, it, expect } from 'vitest'
import { crumbSegments } from './crumbSegments'
import { createResourceRef } from './resourceRef'

describe('crumbSegments', () => {
  it('names the connection, then each level of the resource with its icon', () => {
    const target = createResourceRef('c1', [
      { kind: 'database', name: 'payments' },
      { kind: 'schema', name: 'public' },
      { kind: 'table', name: 'merchants' },
    ])
    expect(crumbSegments({ connection: 'Payments PG', target })).toEqual([
      { icon: null, label: 'Payments PG' },
      { icon: 'dbSmall', label: 'payments' },
      { icon: 'folder', label: 'public' },
      { icon: 'table', label: 'merchants' },
    ])
  })

  it('leads with the login when given, and ends with a pane of its own', () => {
    const target = createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }])
    expect(crumbSegments({ user: 'app', connection: 'Local', target, extra: { icon: 'anchor', label: 'Indexes' } })).toEqual([
      { icon: null, label: 'app' },
      { icon: null, label: 'Local' },
      { icon: 'dbSmall', label: 'shop' },
      { icon: 'collSmall', label: 'orders' },
      { icon: 'anchor', label: 'Indexes' },
    ])
  })

  it('gives a level of an unknown kind no icon rather than a wrong one', () => {
    const target = createResourceRef('c1', [{ kind: 'view', name: 'v' }])
    expect(crumbSegments({ connection: 'x', target })[1]).toEqual({ icon: null, label: 'v' })
  })
})
