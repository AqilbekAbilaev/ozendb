import { describe, it, expect } from 'vitest'
import { tableErrorText } from './tableError.js'

describe('tableErrorText', () => {
  it('says a table is gone, keeping which one the server named', () => {
    const text = tableErrorText({ code: 'missing', message: 'relation "public.merchants" does not exist' })
    expect(text).toBe('This table can\'t be found — it may have been dropped or renamed. (relation "public.merchants" does not exist)')
  })

  it('says the role may not read it', () => {
    const text = tableErrorText({ code: 'forbidden', message: 'permission denied for table merchants' })
    expect(text).toBe('You don\'t have permission to read this. (permission denied for table merchants)')
  })

  it('keeps any other message as the server wrote it', () => {
    expect(tableErrorText({ code: 'command', message: 'invalid input syntax for type integer: "x"' }))
      .toBe('invalid input syntax for type integer: "x"')
  })
})
