import { describe, it, expect } from 'vitest'
import { applyConnectionUpdate } from './connectionList'

const list = () => [
  { id: 'a', name: 'alpha' },
  { id: 'b', name: 'beta' },
  { id: 'c', name: 'gamma' },
]

describe('applyConnectionUpdate', () => {
  it('replaces the matching connection', () => {
    const out = applyConnectionUpdate(list(), { id: 'b', name: 'renamed' })
    expect(out.map(c => c.name)).toEqual(['alpha', 'renamed', 'gamma'])
  })

  it('replaces the entry wholesale rather than merging into it', () => {
    // The event carries the connection's full new state, so a field the edit cleared
    // must disappear rather than survive from the old copy.
    const out = applyConnectionUpdate([{ id: 'a', name: 'alpha', tag: 'red' }], { id: 'a', name: 'alpha' })
    expect(out[0].tag).toBe(undefined)
  })

  it('leaves the list alone when the connection is not in it', () => {
    // The sidebar only holds open connections; editing a closed one must not open it.
    const before = list()
    expect(applyConnectionUpdate(before, { id: 'z', name: 'zeta' })).toEqual(before)
  })

  it('does not mutate the list it was given', () => {
    const before = list()
    applyConnectionUpdate(before, { id: 'b', name: 'renamed' })
    expect(before[1].name).toBe('beta')
  })
})
