import { beforeEach, describe, expect, it } from 'vitest'
import { treeSelection, setTreeSelection, clearTreeSelectionUnder } from './connectionNavigation'
import {
  connectionOpenRequest,
  consumeConnectionOpenRequest,
  requestConnectionOpen,
} from './connectionNavigation'
import { createResourceRef } from '../utils/resourceRef'

const ref = (connectionId, ...levels) => createResourceRef(connectionId, levels.map(([kind, name]) => ({ kind, name })))

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

// The tree builds each selection's ref where the clicked level is certain; the store
// keeps the selection as it is given.
describe('treeSelection', () => {
  beforeEach(() => { treeSelection.value = null })

  it('keeps the selection it is given', () => {
    const sel = { resource: ref('a', ['database', 'shop']), connectionName: 'A', engine: 'mongodb' }
    setTreeSelection(sel)
    expect(treeSelection.value).toEqual(sel)
  })

  it('clears to null', () => {
    setTreeSelection({ resource: ref('a'), connectionName: 'A', engine: 'mongodb' })
    setTreeSelection(null)
    expect(treeSelection.value).toBeNull()
  })
})

// #154: a dropped node must not stay selected for the menu to act on.
describe('clearTreeSelectionUnder', () => {
  const db = { connectionId: 'a', segments: [{ kind: 'database', name: 'shop' }] }
  beforeEach(() => { treeSelection.value = null })

  it('clears the dropped node itself', () => {
    setTreeSelection({ resource: ref('a', ['database', 'shop']) })
    clearTreeSelectionUnder(db)
    expect(treeSelection.value).toBeNull()
  })

  it('clears a node inside the dropped one', () => {
    setTreeSelection({ resource: ref('a', ['database', 'shop'], ['collection', 'orders']) })
    clearTreeSelectionUnder(db)
    expect(treeSelection.value).toBeNull()
  })

  it('clears a PostgreSQL table inside a dropped schema', () => {
    setTreeSelection({
      resource: ref('a', ['database', 'app'], ['schema', 'public'], ['table', 'widgets']),
      connectionId: 'a', engine: 'postgresql', database: 'app', schema: 'public', table: 'widgets', kind: 'table',
    })
    clearTreeSelectionUnder({
      connectionId: 'a', segments: [{ kind: 'database', name: 'app' }, { kind: 'schema', name: 'public' }],
    })
    expect(treeSelection.value).toBeNull()
  })

  it('keeps a selection outside the dropped node', () => {
    setTreeSelection({ resource: ref('a', ['database', 'other'], ['collection', 'orders']) })
    clearTreeSelectionUnder(db)
    expect(treeSelection.value).not.toBeNull()
    setTreeSelection({ resource: ref('a') })
    clearTreeSelectionUnder(db)
    expect(treeSelection.value).not.toBeNull()
  })

  it('does nothing with no selection', () => {
    clearTreeSelectionUnder(db)
    expect(treeSelection.value).toBeNull()
  })
})
