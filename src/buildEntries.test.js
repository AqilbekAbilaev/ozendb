import { describe, it, expect } from 'vitest'
import { build, loadConfigFromFile } from 'vite'

// The app builds two HTML entries: index.html and the document editor/viewer's second
// Tauri window at src/pages/document.html. A broken `build.rolldownOptions.input` drops
// an entry silently — `npm run build` still exits 0, and the only symptom is that window
// 404ing in the packaged app. Build through the real config (not lib mode) to catch that.
describe('build entries', () => {
  it('emits both configured HTML entries', async () => {
    const { config } = await loadConfigFromFile({ command: 'build', mode: 'production' }, 'vite.config.js')
    const result = await build({
      ...config,
      configFile: false,
      logLevel: 'silent',
      build: { ...config.build, write: false },
    })
    const output = Array.isArray(result) ? result[0].output : result.output
    // Asset filenames are content-hashed, but the HTML entries keep the names the
    // config gave them, so matching on those stays stable as the app's chunks change.
    const htmlEntries = output.filter((o) => o.fileName.endsWith('.html')).map((o) => o.fileName)
    expect(htmlEntries).toEqual(expect.arrayContaining(['index.html', 'src/pages/document.html']))
  }, 60_000)
})
