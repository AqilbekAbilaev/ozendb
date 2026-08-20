import { describe, it, expect } from 'vitest'
import { appDefinitions } from './appDefinitions'

describe('app.quickstart definition', () => {
  const def = appDefinitions.find(d => d.type === 'app.quickstart')

  it('is registered with its type and engine', () => {
    expect(def.engine).toBe('app')
    expect(def.component).toBeTruthy()
  })

  it('creates the home tab with no resource target and no engine state', () => {
    const created = def.create({ target: null, defaults: {}, options: {}, ids: { workspace: () => 'w', session: () => 's' } })
    expect(created.title).toBe('Quickstart')
    expect(created.target).toBe(null)
    expect(created.fields).toEqual({ kind: 'quickstart' })
  })
})