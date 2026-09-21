import { expect, it } from 'vitest'
import { isEditingTarget } from './editingTarget'

const el = (matches) => ({ closest: (sel) => (matches ? { sel } : null) })

it('is true inside a field or a code editor', () => {
  expect(isEditingTarget(el(true))).toBe(true)
})

it('is false elsewhere in the page', () => {
  expect(isEditingTarget(el(false))).toBe(false)
})

// Keydown targets can be `window` or `document`, which have no closest().
it('is false for a target that is not an element', () => {
  expect(isEditingTarget(null)).toBe(false)
  expect(isEditingTarget({})).toBe(false)
})
