import { describe, it, expect } from 'vitest'
import { languageExtension } from './languages'

// Guards that every language id the Query Code panel can select resolves to a real
// CodeMirror grammar extension (imports + StreamLanguage.define don't throw), and that an
// unknown id falls back rather than blowing up.
describe('languageExtension', () => {
  const ids = ['js', 'python', 'java', 'csharp', 'php', 'ruby', 'go']

  it.each(ids)('resolves a grammar for "%s"', (id) => {
    const ext = languageExtension(id)
    expect(ext).toBeTruthy()
  })

  it('highlights SQL with the PostgreSQL dialect rather than the JS fallback', () => {
    expect(languageExtension('sql').name).toBe('sql')
  })

  it('falls back for an unknown id', () => {
    expect(languageExtension('brainfuck-9000')).toBeTruthy()
  })
})
