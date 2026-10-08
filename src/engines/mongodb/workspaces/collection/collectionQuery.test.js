import { describe, it, expect } from 'vitest'
import { parseFindQuery, findQueryValid, findQueryError, pipelineError, expandIdFilter, findArgs } from './collectionQuery'
import { parsePipeline } from '../../../../utils/queryParser'

const query = (over = {}) => ({ filter: '', projection: '', sort: '', skip: 0, limit: 50, ...over })

describe('parseFindQuery', () => {
  it('parses all three document fields, treating blanks as empty documents', () => {
    const parsed = parseFindQuery(query({ filter: '{ a: 1 }' }))
    expect(findQueryValid(parsed)).toBe(true)
    expect(JSON.parse(parsed.filter.ejson)).toEqual({ a: { $numberInt: '1' } })
    expect(parsed.sort.ejson).toBe('{}')
  })
})

describe('findQueryError', () => {
  it('names the first field that does not parse', () => {
    expect(findQueryError(parseFindQuery(query({ projection: '{ a: ', sort: '{ b: ' })))).toMatch(/^Projection: /)
    expect(findQueryError(parseFindQuery(query({ sort: '{ b: ' })))).toMatch(/^Sort: /)
    expect(findQueryError(parseFindQuery(query()))).toBe(null)
  })
})

describe('pipelineError', () => {
  it('prefixes a pipeline parse error, and is null for a good one', () => {
    expect(pipelineError(parsePipeline('[ { $match: '))).toMatch(/^Pipeline: /)
    expect(pipelineError(parsePipeline('[]'))).toBe(null)
    expect(pipelineError(null)).toBe(null)
  })
})

describe('expandIdFilter', () => {
  it('turns a bare ObjectId into the _id filter it means', () => {
    expect(expandIdFilter(' 507f1f77bcf86cd799439011 ')).toBe('{ _id: ObjectId("507f1f77bcf86cd799439011") }')
  })

  it('leaves anything else as typed', () => {
    expect(expandIdFilter('{ a: 1 }')).toBe('{ a: 1 }')
    expect(expandIdFilter('507f1f77')).toBe('507f1f77')
  })
})

describe('findArgs', () => {
  it('packs the parsed fields with paging, defaulting skip and limit', () => {
    const q = query({ skip: undefined, limit: undefined })
    expect(findArgs(q, parseFindQuery(q))).toEqual({ filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: 50 })
  })
})
