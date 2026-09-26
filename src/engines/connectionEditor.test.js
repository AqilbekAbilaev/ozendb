import { describe, it, expect } from 'vitest'
import { CONNECTION_EDITORS, SHARED_TABS } from './connectionEditor.js'
import { ENGINE_OPTIONS } from '../data/connectionOptions.js'

describe('CONNECTION_EDITORS', () => {
  it('has an editor for every engine the intro screen offers', () => {
    for (const { value } of ENGINE_OPTIONS) {
      expect(CONNECTION_EDITORS[value], value).toBeDefined()
    }
  })

  it('gives every tab an engine declares either a section or a shared body', () => {
    for (const [engine, editor] of Object.entries(CONNECTION_EDITORS)) {
      for (const [tab] of editor.tabs) {
        const covered = SHARED_TABS.includes(tab) || !!editor.sections[tab]
        expect(covered, `${engine}: ${tab}`).toBe(true)
      }
    }
  })

  it('offers the SSH and General tabs on every engine', () => {
    for (const editor of Object.values(CONNECTION_EDITORS)) {
      const tabs = editor.tabs.map(([tab]) => tab)
      expect(tabs).toEqual(expect.arrayContaining(SHARED_TABS))
    }
  })

  it('gives PostgreSQL no Advanced tab and no connection-string import', () => {
    expect(CONNECTION_EDITORS.postgresql.tabs.map(([tab]) => tab)).not.toContain('advanced')
    expect(CONNECTION_EDITORS.postgresql.supportsUri).toBe(false)
    expect(CONNECTION_EDITORS.mongodb.supportsUri).toBe(true)
  })
})
