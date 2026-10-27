import { describe, it, expect } from 'vitest'
import { postgresqlMenu } from './menu'
import { createResourceRef } from '../../utils/resourceRef'

// Built the way PostgresTreeNodes builds a selection: one segment per level clicked.
const pgSel = (...names) => ({
  engine: 'postgresql',
  resource: createResourceRef('pg 1', names.map((name, i) => ({ kind: ['database', 'schema', 'table'][i], name }))),
})

describe('postgresqlMenu.selectionEnables', () => {
  it('is true from a schema down', () => {
    expect(postgresqlMenu.selectionEnables(pgSel('app.db', 'püblic'))).toBe(true)
    expect(postgresqlMenu.selectionEnables(pgSel('app.db', 'püblic', 'order lines'))).toBe(true)
  })

  it('is false for a connection or database row, or no selection', () => {
    expect(postgresqlMenu.selectionEnables(pgSel())).toBe(false)
    expect(postgresqlMenu.selectionEnables(pgSel('app.db'))).toBe(false)
    expect(postgresqlMenu.selectionEnables(null)).toBe(false)
  })

  it('is false for a MongoDB selection of the same depth', () => {
    expect(postgresqlMenu.selectionEnables({ ...pgSel('shop', 'orders'), engine: 'mongodb' })).toBe(false)
  })
})
