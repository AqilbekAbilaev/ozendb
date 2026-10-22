import { describe, it, expect } from 'vitest'
import { resultColumns } from './resultColumns.js'

describe('resultColumns', () => {
  it('keys each column by its name while every name is its own', () => {
    expect(resultColumns(['id', 'name'])).toEqual({ keys: ['id', 'name'], info: {} })
  })

  it('gives a repeated name its own key, keeping the name for the header', () => {
    expect(resultColumns(['id', 'id', 'name', 'id'])).toEqual({
      keys: ['id', 'id_2', 'name', 'id_3'],
      info: { id_2: { name: 'id' }, id_3: { name: 'id' } },
    })
  })

  it('never takes a key the query itself returned', () => {
    expect(resultColumns(['id', 'id', 'id_2']).keys).toEqual(['id', 'id_3', 'id_2'])
  })
})
