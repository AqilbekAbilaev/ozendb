import { describe, it, expect } from 'vitest'
import { engineLabel } from './connectionOptions.js'

describe('engineLabel', () => {
  it('names a known engine as people write it', () => {
    expect(engineLabel('postgresql')).toBe('PostgreSQL')
  })

  it('names MariaDB as people write it, apart from MySQL', () => {
    expect(engineLabel('mariadb')).toBe('MariaDB')
    expect(engineLabel('mysql')).toBe('MySQL')
  })

  it('falls back to the engine name it was given, rather than failing the screen', () => {
    expect(engineLabel('cockroach db')).toBe('cockroach db')
  })
})
