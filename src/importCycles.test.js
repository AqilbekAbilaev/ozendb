import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'

// A circular import leaves one of the two modules half-initialised at the moment the
// other reads it, so the failure is a confusing undefined at startup rather than an
// error at the import. The frontend has none, and the store-to-store imports that
// replaced App.vue's wiring are exactly the shape that would introduce one — hence a
// guard here rather than a seventh devDependency for eslint-plugin-import.

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(js|vue)$/.test(entry) && !/\.test\.js$/.test(entry)) out.push(full)
  }
  return out
}

// Matches both static `from '...'` and the lazy `import('...')` the modal registry uses.
function localImports(file) {
  const source = readFileSync(file, 'utf8')
  const specs = [
    ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/import\(\s*['"]([^'"]+)['"]/g),
  ].map((m) => m[1]).filter((s) => s.startsWith('.'))

  return specs.map((spec) => {
    const base = normalize(join(dirname(file), spec))
    return [base, `${base}.js`, `${base}.vue`, join(base, 'index.js')]
      .find((c) => existsSync(c) && statSync(c).isFile())
  }).filter(Boolean)
}

// Depth-first walk; a node still on the current stack closes a cycle.
function findCycles(files) {
  const graph = Object.fromEntries(files.map((f) => [f, localImports(f)]))
  const state = {}
  const cycles = []

  function visit(node, stack) {
    state[node] = 'open'
    stack.push(node)
    for (const next of graph[node] || []) {
      if (state[next] === 'open') cycles.push([...stack.slice(stack.indexOf(next)), next])
      else if (!state[next]) visit(next, stack)
    }
    stack.pop()
    state[node] = 'done'
  }

  for (const file of files) if (!state[file]) visit(file, [])
  return cycles
}

describe('import graph', () => {
  it('has no cycles', () => {
    const cycles = findCycles(sourceFiles('src'))
    expect(cycles.map((c) => c.join(' -> '))).toEqual([])
  })
})
