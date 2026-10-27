import { describe, it, expect } from 'vitest'
import { mongoMenu } from './menu'
import { createResourceRef } from '../../utils/resourceRef'

const ref = createResourceRef('c 1', [{ kind: 'database', name: 'shop/eu' }])

describe('mongoMenu.selectionEnables', () => {
  it('is true for any MongoDB row, a connection included', () => {
    expect(mongoMenu.selectionEnables({ engine: 'mongodb', resource: createResourceRef('c 1', []) })).toBe(true)
    expect(mongoMenu.selectionEnables({ engine: 'mongodb', resource: ref })).toBe(true)
  })

  it('treats a selection with no engine as MongoDB', () => {
    expect(mongoMenu.selectionEnables({ resource: ref })).toBe(true)
  })

  it("is false for another engine's row, or no selection", () => {
    expect(mongoMenu.selectionEnables({ engine: 'postgresql', resource: ref })).toBe(false)
    expect(mongoMenu.selectionEnables(null)).toBe(false)
  })
})

describe('mongoMenu.tabNamesConnection', () => {
  it('is true for a MongoDB tab naming a resource', () => {
    expect(mongoMenu.tabNamesConnection({ type: 'mongodb.find', target: ref })).toBe(true)
  })

  it('is false for a tab naming no resource, or another engine\'s tab', () => {
    expect(mongoMenu.tabNamesConnection({ type: 'app.quickstart' })).toBe(false)
    expect(mongoMenu.tabNamesConnection({ engine: 'postgresql', target: ref })).toBe(false)
  })
})
