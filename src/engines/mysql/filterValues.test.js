import { describe, it, expect } from 'vitest'
import { filterText, inUtc } from './filterValues.js'
import { dialect } from './sql.js'

const { filterLiteral } = dialect

describe('filterLiteral', () => {
  it('writes an exact number as itself, so MySQL compares it exactly rather than as floating point', () => {
    expect(filterLiteral('18446744073709551615', 'bigint unsigned')).toBe('18446744073709551615')
    expect(filterLiteral(' 1.505 ', 'decimal(10,2)')).toBe('1.505')
    expect(filterLiteral('-1.50e-3', 'decimal(30,10)')).toBe('-0.00150')
    expect(filterLiteral('12e3', 'int')).toBe('12000')
    expect(filterLiteral('.5', 'decimal(3,2)')).toBe('0.5')
    expect(filterLiteral('5', 'bit(3)')).toBe('5')
  })

  it('writes true and false on TINYINT(1) as the 1 and 0 it stores, in any case', () => {
    expect(filterLiteral('true', 'tinyint(1)')).toBe('1')
    expect(filterLiteral(' FALSE ', 'tinyint(1) unsigned')).toBe('0')
    expect(filterLiteral('251', 'tinyint(1) unsigned')).toBe('251')
  })

  it('quotes anything else, and a number column\'s value that is not a number', () => {
    expect(filterLiteral('true', 'tinyint(4)')).toBe("'true'")
    expect(filterLiteral('1e999', 'decimal(10,2)')).toBe("'1e999'")
    expect(filterLiteral("it's ü", 'varchar(20)')).toBe("'it''s ü'")
    expect(filterLiteral('0.1', 'double')).toBe("'0.1'")
    expect(filterLiteral('5', undefined)).toBe("'5'")
  })

  it('writes a TIMESTAMP\'s date and time as the UTC MySQL compares it in', () => {
    expect(filterLiteral('2024-01-01 05:00:00+05:00', 'timestamp')).toBe("'2024-01-01 00:00:00'")
    expect(filterLiteral('2024-01-01', 'timestamp')).toBe("'2024-01-01'")
  })
})

describe('filterText', () => {
  it('matches a TIMESTAMP\'s whole date and time in UTC, and anything else as typed', () => {
    expect(filterText('2024-01-01 05:00:00.5+05:00', 'timestamp(3)')).toBe('2024-01-01 00:00:00.500')
    expect(filterText('2024-01', 'timestamp')).toBe('2024-01')
    expect(filterText('2024-01-01 05:00:00+05:00', 'datetime')).toBe('2024-01-01 05:00:00+05:00')
  })
})

describe('inUtc', () => {
  it('reads a date and time with an offset as that instant', () => {
    expect(inUtc('2024-06-30 23:30:00-02:30', 0)).toBe('2024-07-01 02:00:00')
    expect(inUtc('2024-01-01 00:00:00.123456789+00:00', 6)).toBe('2024-01-01 00:00:00.123456')
  })

  it('reads one without an offset in the user\'s own zone', () => {
    const local = new Date(2024, 0, 15, 9, 30, 0)
    const utc = local.toISOString().slice(0, 19).replace('T', ' ')
    expect(inUtc('2024-01-15 09:30:00', 0)).toBe(utc)
  })

  it('leaves out what is not a whole, real date and time', () => {
    expect(inUtc('2024-02-30 00:00:00', 0)).toBe(null)
    expect(inUtc('2024-01-01 00:00', 0)).toBe(null)
    expect(inUtc('ü', 0)).toBe(null)
  })
})
