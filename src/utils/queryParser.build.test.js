// The production Rollup build once bundled mongodb-query-parser with `parseFilter`
// undefined, while the dev server and the unit tests, which run the source, were fine
// (see the alias in vite.config.js). @mongodb-js/shell-bson-parser, which replaced it,
// has the identical .esm-wrapper.mjs re-export shape, so the same failure is possible
// again under a bundler that hits it. A successful build doesn't prove it either, so
// build the parser through the app's own Vite config and call the result.
import { describe, it, expect } from 'vitest'
import { build, loadConfigFromFile } from 'vite'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

describe('queryParser in the production bundle', () => {
  it('parses a filter', async () => {
    const { config } = await loadConfigFromFile({ command: 'build', mode: 'production' }, 'vite.config.js')
    const [result] = await build({
      ...config,
      configFile: false,
      logLevel: 'silent',
      build: {
        ...config.build,
        write: false,
        rollupOptions: {},
        lib: { entry: 'src/utils/queryParser.js', formats: ['es'], fileName: 'queryParser' },
      },
    })
    const entry = result.output.find((o) => o.type === 'chunk' && o.isEntry)
    const dir = await mkdtemp(join(tmpdir(), 'ozendb-build-'))
    try {
      const file = join(dir, 'queryParser.mjs')
      await writeFile(file, entry.code)
      const { parseField } = await import(pathToFileURL(file).href)
      expect(parseField('{ a: 1 }')).toEqual({ ok: true, ejson: '{"a":{"$numberInt":"1"}}', error: null })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
