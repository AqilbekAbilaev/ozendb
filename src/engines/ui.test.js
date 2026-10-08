import { describe, it, expect } from 'vitest'
import { CONNECTION_EDITORS, SHARED_TABS } from './ui.js'
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

  it('gives PostgreSQL no Advanced tab', () => {
    expect(CONNECTION_EDITORS.postgresql.tabs.map(([tab]) => tab)).not.toContain('advanced')
  })

  it('reads each engine\'s own connection strings, and only those', () => {
    expect(CONNECTION_EDITORS.postgresql.parseUri('postgresql://u@h/db').database).toBe('db')
    expect(CONNECTION_EDITORS.postgresql.parseUri('mongodb://h')).toBe(null)
    expect(CONNECTION_EDITORS.mongodb.parseUri('mongodb://h')).not.toBe(null)
    expect(CONNECTION_EDITORS.mongodb.parseUri('postgresql://u@h/db')).toBe(null)
  })
})
