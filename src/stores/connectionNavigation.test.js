import { beforeEach, describe, expect, it } from 'vitest'
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
