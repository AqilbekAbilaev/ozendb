import { describe, it, expect } from 'vitest'
import { parseField, parsePipeline } from './queryParser'

// queryParser.js is the beta-critical shell-syntax → Extended JSON step. These lock its
// behaviour so the silent query-corruption the regex approach caused can't return.

describe('parseField', () => {
  it('parses a simple document', () => {
    expect(parseField('{name: "John"}')).toEqual({ ok: true, ejson: '{"name":"John"}', error: null })
  })

  it('does NOT corrupt a string containing a comma and colon', () => {
    const r = parseField('{note: "hello, world: x"}')
    expect(r.ok).toBe(true)
    expect(r.ejson).toBe('{"note":"hello, world: x"}')
  })

  it('treats ObjectId(...) inside a string as a literal, not an $oid', () => {
    const r = parseField('{label: "ObjectId(\\"507f1f77bcf86cd799439011\\")"}')
    expect(r.ok).toBe(true)
    expect(r.ejson).not.toContain('$oid')
    expect(r.ejson).toContain('ObjectId(')
  })

  it('parses an ObjectId() value to $oid', () => {
    const r = parseField('{_id: ObjectId("507f1f77bcf86cd799439011")}')
    expect(r.ejson).toBe('{"_id":{"$oid":"507f1f77bcf86cd799439011"}}')
  })

  it('expands a bare 24-hex id into an _id filter', () => {
    const r = parseField('507f1f77bcf86cd799439011')
    expect(r.ejson).toBe('{"_id":{"$oid":"507f1f77bcf86cd799439011"}}')
  })

  it('parses nested operators with canonical numbers', () => {
    expect(parseField('{age: {$gt: 18}}').ejson).toBe('{"age":{"$gt":{"$numberInt":"18"}}}')
  })

  it('parses a regex literal', () => {
    const r = parseField('{name: /^jo/i}')
    expect(r.ok).toBe(true)
    expect(r.ejson).toContain('$regularExpression')
  })

  it('parses ISODate to $date', () => {
    const r = parseField('{created: ISODate("2024-01-01T00:00:00Z")}')
    expect(r.ok).toBe(true)
    expect(r.ejson).toContain('$date')
  })

  it('normalizes smart quotes', () => {
    const r = parseField('{“name”: “John”}')
    expect(r.ok).toBe(true)
    expect(r.ejson).toBe('{"name":"John"}')
  })

  it('treats empty and {} as the identity', () => {
    expect(parseField('').ejson).toBe('{}')
    expect(parseField('   ').ejson).toBe('{}')
    expect(parseField('{}').ejson).toBe('{}')
  })

  it('reports invalid input without throwing', () => {
    const r = parseField('{bad json')
    expect(r.ok).toBe(false)
    expect(r.ejson).toBeNull()
    expect(r.error).toBeTruthy()
  })

  it('rejects a non-document (array)', () => {
    expect(parseField('[1, 2, 3]').ok).toBe(false)
  })
})

describe('parsePipeline', () => {
  it('parses a pipeline array into EJSON', () => {
    const r = parsePipeline('[{$match: {x: 1}}, {$group: {_id: "$y"}}]')
    expect(r.ok).toBe(true)
    expect(JSON.parse(r.ejson)).toHaveLength(2)
  })

  it('treats empty and [] as the identity', () => {
    expect(parsePipeline('').ejson).toBe('[]')
    expect(parsePipeline('[]').ejson).toBe('[]')
  })

  it('rejects a non-array pipeline', () => {
    expect(parsePipeline('{not: "an array"}').ok).toBe(false)
  })

  it('reports invalid input without throwing', () => {
    const r = parsePipeline('[bad')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})
