// Rollup once bundled this parser's .esm-wrapper.mjs with the export undefined, in
// production only. Rolldown handles it, but a passing build doesn't prove that, so build
// the parser through the app's own config and call the result.
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
        rolldownOptions: {},
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
