import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileScript, parse } from '@vue/compiler-sfc'

describe('App workspace bindings', () => {
  it('provides the tab close handler used by WorkspaceArea', () => {
    const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
    const { descriptor } = parse(source)
    const script = compileScript(descriptor, { id: 'app' })

    expect(descriptor.template.content).toContain('@close-tab="closeTab"')
    expect(script.bindings.closeTab).toBe('setup-maybe-ref')
  })

  it('keeps pasted query mode aligned with its workspace type', () => {
    const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
    const { descriptor } = parse(source)

    expect(descriptor.scriptSetup.content).toContain('setCollectionQueryMode(tab, q.mode)')
  })
})
