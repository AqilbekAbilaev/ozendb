import { describe, it, expect } from 'vitest'
import { ENGINES, DEFAULT_ENGINE, engineOf } from './index.js'
import { ENGINE_OPTIONS } from '../data/connectionOptions.js'

describe('the engine table', () => {
  it('has an entry, under its own id, for every engine the editor offers', () => {
    for (const { value } of ENGINE_OPTIONS) {
      expect(ENGINES[value]?.id, value).toBe(value)
    }
  })

  it('gives every engine everything shared code asks of it', () => {
    for (const engine of Object.values(ENGINES)) {
      expect(Number.isInteger(engine.defaultPort), engine.id).toBe(true)
      expect(typeof engine.namesDatabase, engine.id).toBe('boolean')
      expect(typeof engine.buildFields, engine.id).toBe('function')
      expect(typeof engine.loadResources, engine.id).toBe('function')
      for (const hook of ['kind', 'label', 'read']) {
        expect(typeof engine.statsTip[hook], `${engine.id}.statsTip.${hook}`).toBe('function')
      }
    }
  })

  it('knows the default ports and which engine names a database up front', () => {
    expect(ENGINES.mongodb.defaultPort).toBe(27017)
    expect(ENGINES.postgresql.defaultPort).toBe(5432)
    expect(ENGINES.mongodb.namesDatabase).toBe(false)
    expect(ENGINES.postgresql.namesDatabase).toBe(true)
  })
})

describe('engineOf', () => {
  it('reads the engine a connection, tab or node carries', () => {
    expect(engineOf({ engine: 'postgresql' })).toBe(ENGINES.postgresql)
    expect(engineOf({ engine: 'mongodb' })).toBe(ENGINES.mongodb)
  })

  it('treats a record from before engines existed as MongoDB', () => {
    expect(DEFAULT_ENGINE).toBe('mongodb')
    expect(engineOf({})).toBe(ENGINES.mongodb)
    expect(engineOf(null)).toBe(ENGINES.mongodb)
    expect(engineOf(undefined)).toBe(ENGINES.mongodb)
  })
})
