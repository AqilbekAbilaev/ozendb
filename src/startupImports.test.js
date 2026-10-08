import { describe, it, expect } from 'vitest'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'

// Whatever main.js reaches through static imports is parsed on every launch. CodeMirror
// once crept back onto that path behind a comment still claiming it was lazy, so the
// line is held here: a `import()` boundary is the only way in.

function resolveLocal(file, spec) {
  const base = normalize(join(dirname(file), spec))
  return [base, `${base}.js`, `${base}.vue`, join(base, 'index.js')]
    .find((c) => existsSync(c) && statSync(c).isFile())
}

// Every package reachable from `entry` without crossing a dynamic import.
function startupPackages(entry) {
  const seen = new Set()
  const packages = new Set()
  const stack = [entry]
  while (stack.length) {
    const file = stack.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    const specs = [
      ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ].map((m) => m[1])
    for (const spec of specs) {
      if (!spec.startsWith('.')) packages.add(spec)
      else {
        const next = resolveLocal(file, spec)
        if (next && /\.(js|vue)$/.test(next)) stack.push(next)
      }
    }
  }
  return [...packages]
}

describe('startup imports', () => {
  it('keep CodeMirror behind a dynamic import', () => {
    const editor = startupPackages('src/main.js').filter((p) => /^@(codemirror|lezer)\//.test(p))
    expect(editor).toEqual([])
  })
})
