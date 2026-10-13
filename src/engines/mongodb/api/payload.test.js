import { describe, it, expect } from 'vitest'
import { apiTarget, connectionPayload, databasePayload, collectionPayload } from './payload'
import { createResourceRef } from '../../../utils/resourceRef'

const target = { connectionId: 'connection-1', database: 'app', collection: 'users' }

describe('apiTarget', () => {
  it('names only the levels the ref reaches', () => {
    expect(apiTarget(createResourceRef('c1'))).toEqual({ connectionId: 'c1' })
    expect(apiTarget(createResourceRef('c1', [{ kind: 'database', name: 'app' }])))
      .toEqual({ connectionId: 'c1', database: 'app' })
  })

  it('turns a collection ref into the full target', () => {
    const ref = createResourceRef('c1', [{ kind: 'database', name: 'app' }, { kind: 'collection', name: 'a/b' }])
    expect(apiTarget(ref)).toEqual({ connectionId: 'c1', database: 'app', collection: 'a/b' })
  })
})

describe('connectionPayload', () => {
  it('translates connectionId to the backend id key', () => {
    expect(connectionPayload('connection-1')).toEqual({ id: 'connection-1' })
  })

  it('preserves extra payload fields', () => {
    expect(connectionPayload('connection-1', { comment: 'run-1', opid: 42 })).toEqual({
      id: 'connection-1',
      comment: 'run-1',
      opid: 42,
    })
  })

  it('keeps the connectionId translation even when extras are passed', () => {
    expect(connectionPayload('connection-1', { id: 'wrong' })).toEqual({ id: 'connection-1' })
  })
})

describe('databasePayload', () => {
  it('translates the target into id and database keys', () => {
    expect(databasePayload(target)).toEqual({ id: 'connection-1', database: 'app' })
  })

  it('preserves extra payload fields', () => {
    expect(databasePayload(target, { pipeline: '[]' })).toEqual({
      id: 'connection-1',
      database: 'app',
      pipeline: '[]',
    })
  })
})

describe('collectionPayload', () => {
  it('translates the target into id, database and collection keys', () => {
    expect(collectionPayload(target)).toEqual({
      id: 'connection-1',
      database: 'app',
      collection: 'users',
    })
  })

  it('preserves extra payload fields', () => {
    expect(collectionPayload(target, { filter: '{}', comment: 'run-1' })).toEqual({
      id: 'connection-1',
      database: 'app',
      collection: 'users',
      filter: '{}',
      comment: 'run-1',
    })
  })
})