import { describe, it, expect } from 'vitest'
import { canWriteTab, isWriteAction, WRITE_ACTIONS } from './writable'

describe('canWriteTab', () => {
  it('allows writes without a tab or lock', () => {
    expect(canWriteTab(undefined)).toBe(true)
    expect(canWriteTab(null)).toBe(true)
    expect(canWriteTab({})).toBe(true)
    expect(canWriteTab({ readOnly: false })).toBe(true)
  })

  it('refuses writes while the lock is on', () => {
    expect(canWriteTab({ readOnly: true })).toBe(false)
  })
})

describe('isWriteAction', () => {
  it('marks every document/collection write action', () => {
    for (const id of WRITE_ACTIONS) {
      expect(isWriteAction(id), id).toBe(true)
    }
  })

  it('leaves read-only actions unmarked', () => {
    for (const id of ['doc:view_json', 'edit:copy', 'edit:copy_value', 'view:refresh', 'coll:schema']) {
      expect(isWriteAction(id), id).toBe(false)
    }
  })

  it('the write list is exactly the expected set', () => {
    expect([...WRITE_ACTIONS].sort()).toEqual([
      'coll:clear',
      'coll:delete_dialog',
      'coll:insert_document',
      'coll:update_dialog',
      'doc:add_field',
      'doc:delete',
      'doc:edit_json',
      'doc:edit_value',
      'doc:remove_field',
      'doc:rename_field',
      'edit:paste_documents',
    ])
  })
})