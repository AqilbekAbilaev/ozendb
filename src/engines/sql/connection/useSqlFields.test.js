import { describe, it, expect } from 'vitest'
import { useSqlFields } from './useSqlFields.js'

describe('useSqlFields', () => {
  it('starts a new connection with no database', () => {
    expect(useSqlFields(null).database.value).toBe('')
  })

  it('seeds the database of the connection being edited', () => {
    expect(useSqlFields({ database: 'app' }).database.value).toBe('app')
    expect(useSqlFields({}).database.value).toBe('')
  })

  it('hands over the database as a plain value', () => {
    const sql = useSqlFields({ database: 'app' })
    sql.database.value = 'shop'
    expect(sql.values()).toEqual({ database: 'shop' })
  })

  it('takes the database a pasted connection string names, and keeps its own otherwise', () => {
    const sql = useSqlFields(null)
    sql.applyParsed({ database: 'shop' })
    expect(sql.database.value).toBe('shop')
    sql.applyParsed({ database: null })
    expect(sql.database.value).toBe('shop')
  })
})
