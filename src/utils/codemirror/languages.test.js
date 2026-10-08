import { describe, it, expect } from 'vitest'
import { loadLanguage } from './languages'

// Guards that every language id the Query Code panel can select resolves to its own
// CodeMirror grammar (imports + StreamLanguage.define don't throw, and nothing silently
// falls back to JS), and that an unknown id falls back rather than blowing up.
const grammarName = async (id) => {
  const ext = await loadLanguage(id)
  return (ext.language ?? ext).name
}

describe('loadLanguage', () => {
  it.each([
    ['js', 'javascript'], ['python', 'python'], ['java', 'java'], ['csharp', 'csharp'],
    ['php', 'php'], ['ruby', 'ruby'], ['go', 'go'],
  ])('resolves "%s" to the %s grammar', async (id, name) => {
    expect(await grammarName(id)).toBe(name)
  })

  it('highlights SQL with the PostgreSQL dialect rather than the JS fallback', async () => {
    expect(await grammarName('sql')).toBe('sql')
  })

  it('falls back to JS for an unknown id', async () => {
    expect(await grammarName('brainfuck-9000')).toBe('javascript')
  })
})
