import { describe, it, expect } from 'vitest'
import { connectionPayload, databasePayload, collectionPayload } from './payload'

const target = { connectionId: 'connection-1', database: 'app', collection: 'users' }

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