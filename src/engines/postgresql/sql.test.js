import { describe, it, expect } from 'vitest'
import { dialect } from './sql.js'

const { quoteName, quoteText, like, cellKind, jsonShape, takesValue, fillsItself } = dialect

describe('quoting', () => {
  it('double-quotes a name, doubling any quote inside it', () => {
    expect(quoteName('Order Lines')).toBe('"Order Lines"')
    expect(quoteName('say "hi"')).toBe('"say ""hi"""')
  })

  it('single-quotes a value, doubling any quote inside it', () => {
    expect(quoteText("it's")).toBe("'it''s'")
    expect(quoteText('back\\slash')).toBe("'back\\slash'")
  })
})

describe('like', () => {
  it('matches a column read as text, ignoring case', () => {
    expect(like('"Straße"', '%ö%')).toBe('"Straße"::text ILIKE \'%ö%\'')
  })
})

describe('cellKind', () => {
  it('groups the types format_type() reports by how their cells are styled', () => {
    expect(cellKind('integer')).toBe('num')
    expect(cellKind('numeric(10,2)')).toBe('num')
    expect(cellKind('double precision')).toBe('num')
    expect(cellKind('character varying(255)')).toBe('str')
    expect(cellKind('text')).toBe('str')
    expect(cellKind('uuid')).toBe('str')
    expect(cellKind('timestamp(3) with time zone')).toBe('date')
    expect(cellKind('date')).toBe('date')
    expect(cellKind('boolean')).toBe('bool')
  })

  it('leaves arrays, JSON, enums and unknown columns unstyled', () => {
    expect(cellKind('integer[]')).toBe(null)
    expect(cellKind('jsonb')).toBe(null)
    expect(cellKind('order_status')).toBe(null)
    expect(cellKind(undefined)).toBe(null)
  })

  it('makes a column that lists its labels an enum, whatever its type', () => {
    expect(cellKind('merchant_status', ['active', 'blocked'])).toBe('enum')
    expect(cellKind('merchant_status')).toBe(null)
    expect(cellKind('text', [])).toBe('str')
  })
})

describe('jsonShape', () => {
  it('edits arrays as lists and json or jsonb as JSON', () => {
    expect(jsonShape('text[]')).toBe('list')
    expect(jsonShape('jsonb')).toBe('json')
    expect(jsonShape('json')).toBe('json')
  })

  it('edits every other type as plain text', () => {
    expect(jsonShape('character varying(20)')).toBe(null)
    expect(jsonShape(undefined)).toBe(null)
    expect(jsonShape(null)).toBe(null)
  })
})

describe('takesValue', () => {
  it('refuses identity-always and stored generated columns', () => {
    expect(takesValue({ identity: 'always' })).toBe(false)
    expect(takesValue({ generated: 'stored' })).toBe(false)
  })

  it('accepts by-default identity columns, plain columns and unknown ones', () => {
    expect(takesValue({ identity: 'by default' })).toBe(true)
    expect(takesValue({ dataType: 'text' })).toBe(true)
    expect(takesValue(undefined)).toBe(true)
  })
})

describe('fillsItself', () => {
  it('reports identity columns and serial ones, which number a row left without a value', () => {
    expect(fillsItself({ identity: 'by_default' })).toBe(true)
    expect(fillsItself({ identity: 'always' })).toBe(true)
    expect(fillsItself({ default: `nextval('"order lines ü_id_seq"'::regclass)` })).toBe(true)
  })

  it('leaves out a plain default, a stored generated column and an unknown one', () => {
    expect(fillsItself({ default: "'nextval('::text" })).toBe(false)
    expect(fillsItself({ default: 'now()' })).toBe(false)
    expect(fillsItself({ generated: 'stored' })).toBe(false)
    expect(fillsItself(undefined)).toBe(false)
  })
})
