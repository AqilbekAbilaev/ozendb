import { beforeEach, describe, expect, it } from 'vitest'
import { treeSelection, setTreeSelection } from './connectionNavigation'
import {
  connectionOpenRequest,
  consumeConnectionOpenRequest,
  requestConnectionOpen,
} from './connectionNavigation'

beforeEach(() => {
  consumeConnectionOpenRequest()
})

describe('connection navigation requests', () => {
  it('starts without a pending request', () => {
    expect(connectionOpenRequest.value).toBeNull()
    expect(consumeConnectionOpenRequest()).toBeNull()
  })

  it('records and consumes a connection request', () => {
    const request = requestConnectionOpen('connection-1')
    expect(connectionOpenRequest.value).toEqual(request)
    expect(consumeConnectionOpenRequest()).toEqual(request)
    expect(connectionOpenRequest.value).toBeNull()
  })

  it('uses a new nonce for repeated requests to the same connection', () => {
    const first = requestConnectionOpen('connection-1')
    const second = requestConnectionOpen('connection-1')
    expect(second.connectionId).toBe(first.connectionId)
    expect(second.nonce).toBeGreaterThan(first.nonce)
  })

  it('replaces an unconsumed request with the latest one', () => {
    requestConnectionOpen('first')
    const latest = requestConnectionOpen('second')
    expect(consumeConnectionOpenRequest()).toEqual(latest)
  })
})

// The canonical ResourceRef is derived here, where the clicked level is known for
// certain, rather than re-inferred downstream from which flat fields happen to be set.
describe('treeSelection', () => {
  beforeEach(() => { treeSelection.value = null })

  it('carries a resource ref for each level', () => {
    setTreeSelection({ connectionId: 'a', kind: 'connection' })
    expect(treeSelection.value.resource).toEqual({ connectionId: 'a', segments: [] })
    setTreeSelection({ connectionId: 'a', dbName: 'shop', kind: 'database' })
    expect(treeSelection.value.resource.segments).toEqual([{ kind: 'database', name: 'shop' }])
    setTreeSelection({ connectionId: 'a', dbName: 'shop', collectionName: 'a/b', kind: 'collection' })
    expect(treeSelection.value.resource.segments).toEqual([
      { kind: 'database', name: 'shop' }, { kind: 'collection', name: 'a/b' },
    ])
  })

  it('clears to null', () => {
    setTreeSelection({ connectionId: 'a', kind: 'connection' })
    setTreeSelection(null)
    expect(treeSelection.value).toBeNull()
  })
})
