import { describe, it, expect } from 'vitest'
import {
  resourceFromTreeSelection, resourceFromFeatureNode,
  resourceFromMongoTarget, resourceFromLegacyTab, legacyNodeTagKey,
} from './legacyResourceRef'
import { createResourceRef, sameResource } from './resourceRef'

const CONN_REF = { connectionId: 'c1', segments: [] }
const DB_REF = { connectionId: 'c1', segments: [{ kind: 'database', name: 'shop' }] }
const COLL_REF = {
  connectionId: 'c1',
  segments: [
    { kind: 'database', name: 'shop' },
    { kind: 'collection', name: 'orders' },
  ],
}

describe('resourceFromTreeSelection', () => {
  it('converts connection, database and collection selections', () => {
    expect(resourceFromTreeSelection({
      connectionId: 'c1', connectionName: 'Local', dbName: null, collectionName: null, kind: 'connection',
    })).toEqual(CONN_REF)
    expect(resourceFromTreeSelection({
      connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: null, kind: 'database',
    })).toEqual(DB_REF)
    expect(resourceFromTreeSelection({
      connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders', kind: 'collection',
    })).toEqual(COLL_REF)
  })

  it('returns null for missing fields and unknown kinds', () => {
    expect(resourceFromTreeSelection(null)).toBe(null)
    expect(resourceFromTreeSelection({})).toBe(null)
    expect(resourceFromTreeSelection({ connectionId: 'c1', kind: 'database' })).toBe(null)
    expect(resourceFromTreeSelection({ connectionId: 'c1', kind: 'collection', dbName: 'shop' })).toBe(null)
    expect(resourceFromTreeSelection({ connectionId: 'c1', kind: 'view' })).toBe(null)
  })
})

describe('resourceFromFeatureNode', () => {
  it('derives depth from which short aliases are present', () => {
    expect(resourceFromFeatureNode({ connId: 'c1', connName: 'Local' })).toEqual(CONN_REF)
    expect(resourceFromFeatureNode({ connId: 'c1', connName: 'Local', dbName: 'shop' })).toEqual(DB_REF)
    expect(resourceFromFeatureNode({ connId: 'c1', connName: 'Local', dbName: 'shop', collName: 'orders' }))
      .toEqual(COLL_REF)
  })

  it('returns null for malformed nodes', () => {
    expect(resourceFromFeatureNode(null)).toBe(null)
    expect(resourceFromFeatureNode({})).toBe(null)
    expect(resourceFromFeatureNode({ dbName: 'shop' })).toBe(null)
    expect(resourceFromFeatureNode({ connId: 'c1', collName: 'orders' })).toBe(null)
  })
})

describe('resourceFromMongoTarget', () => {
  it('converts the Mongo query API target shape', () => {
    expect(resourceFromMongoTarget({ connectionId: 'c1' })).toEqual(CONN_REF)
    expect(resourceFromMongoTarget({ connectionId: 'c1', database: 'shop' })).toEqual(DB_REF)
    expect(resourceFromMongoTarget({ connectionId: 'c1', database: 'shop', collection: 'orders' })).toEqual(COLL_REF)
  })

  it('returns null for missing fields', () => {
    expect(resourceFromMongoTarget(null)).toBe(null)
    expect(resourceFromMongoTarget({})).toBe(null)
    expect(resourceFromMongoTarget({ connectionId: 'c1', collection: 'orders' })).toBe(null)
  })
})

describe('resourceFromLegacyTab', () => {
  it('converts every current tab kind', () => {
    // Collection and shell tabs use the long aliases.
    expect(resourceFromLegacyTab({
      kind: 'collection', connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders',
    })).toEqual(COLL_REF)
    expect(resourceFromLegacyTab({
      kind: 'shell', connectionId: 'c1', connectionName: 'Local', dbName: 'shop',
    })).toEqual(DB_REF)
    // Tool tabs use the short aliases.
    expect(resourceFromLegacyTab({ kind: 'indexes', connId: 'c1', connName: 'Local', dbName: 'shop', collName: 'orders' }))
      .toEqual(COLL_REF)
    expect(resourceFromLegacyTab({ kind: 'schema', connId: 'c1', connName: 'Local', dbName: 'shop', collName: 'orders' }))
      .toEqual(COLL_REF)
    expect(resourceFromLegacyTab({ kind: 'export', connId: 'c1', connName: 'Local', dbName: 'shop', collName: 'orders' }))
      .toEqual(COLL_REF)
    expect(resourceFromLegacyTab({ kind: 'import', connId: 'c1', connName: 'Local', dbName: 'shop', collName: 'orders' }))
      .toEqual(COLL_REF)
    expect(resourceFromLegacyTab({ kind: 'search', connId: 'c1', connName: 'Local', dbName: 'shop' }))
      .toEqual(DB_REF)
    expect(resourceFromLegacyTab({ kind: 'currentOps', connId: 'c1', connName: 'Local' }))
      .toEqual(CONN_REF)
    // Quickstart has no resource.
    expect(resourceFromLegacyTab({ kind: 'quickstart', title: 'Quickstart' })).toBe(null)
  })

  it('keeps Current Operations connection-scoped when its filters are populated', () => {
    expect(resourceFromLegacyTab({
      kind: 'currentOps', connId: 'c1', connName: 'Local',
      dbName: 'shop', collName: 'orders',
    })).toEqual(CONN_REF)
  })

  it('accepts either alias set on any kind', () => {
    expect(resourceFromLegacyTab({ kind: 'collection', connId: 'c1', dbName: 'shop', collName: 'orders' }))
      .toEqual(COLL_REF)
    expect(resourceFromLegacyTab({ kind: 'indexes', connectionId: 'c1', dbName: 'shop', collectionName: 'orders' }))
      .toEqual(COLL_REF)
  })

  it('returns null for missing fields and unknown kinds', () => {
    expect(resourceFromLegacyTab(null)).toBe(null)
    expect(resourceFromLegacyTab({})).toBe(null)
    expect(resourceFromLegacyTab({ kind: 'shell' })).toBe(null)
    expect(resourceFromLegacyTab({ kind: 'collection', connectionId: 'c1' })).toBe(null)
    expect(resourceFromLegacyTab({ kind: 'gridfs' })).toBe(null)
  })
})

describe('identity comparison', () => {
  it('ignores connection display names', () => {
    const a = resourceFromFeatureNode({ connId: 'c1', connName: 'Local', dbName: 'shop', collName: 'orders' })
    const b = resourceFromFeatureNode({ connId: 'c1', connName: 'Production', dbName: 'shop', collName: 'orders' })
    expect(sameResource(a, b)).toBe(true)
  })
})

describe('legacyNodeTagKey', () => {
  it('produces exactly the current node-tag keys', () => {
    expect(legacyNodeTagKey(CONN_REF)).toBe('c1')
    expect(legacyNodeTagKey(DB_REF)).toBe('c1/shop')
    expect(legacyNodeTagKey(COLL_REF)).toBe('c1/shop/orders')
  })

  it('preserves collection names containing slashes', () => {
    const ref = resourceFromMongoTarget({ connectionId: 'c1', database: 'app', collection: 'orders/2024' })
    expect(legacyNodeTagKey(ref)).toBe('c1/app/orders/2024')
  })

  it('returns null for deeper or non-Mongo resources and malformed input', () => {
    expect(legacyNodeTagKey(createResourceRef('c1', [
      { kind: 'database', name: 'app' },
      { kind: 'schema', name: 'public' },
      { kind: 'table', name: 'users' },
    ]))).toBe(null)
    expect(legacyNodeTagKey(createResourceRef('c1', [{ kind: 'schema', name: 'public' }]))).toBe(null)
    expect(legacyNodeTagKey(null)).toBe(null)
  })
})