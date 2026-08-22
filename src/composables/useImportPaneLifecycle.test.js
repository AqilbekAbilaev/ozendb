import { describe, expect, it } from 'vitest'
import { useImportPaneLifecycle } from './useImportPaneLifecycle'

const tab = (id, connId, sources = []) => ({
  id,
  connId,
  format: 'json',
  validate: true,
  dbName: 'db',
  collName: 'orders',
  sources,
})

describe('import source acquisition', () => {
  it('freezes the initiating tab, format, and default destination', () => {
    const lifecycle = useImportPaneLifecycle()
    const first = tab('first', 'c1')

    const source = lifecycle.beginSource(first)
    first.format = 'csv'
    first.dbName = 'other'
    first.collName = 'changed'

    expect(source).toEqual({
      tab: first,
      tabId: 'first',
      format: 'json',
      targetDb: 'db',
      targetColl: 'orders',
    })
  })
})

describe('import pane run identity', () => {
  it('freezes the connection, format, and sources for an import run', () => {
    const lifecycle = useImportPaneLifecycle()
    const first = tab('first', 'c1', [
      { path: '/a.json', targetDb: 'db1', targetColl: 'people' },
      { path: '/b.json', targetDb: 'db1', targetColl: 'orders' },
    ])

    lifecycle.attach(first)
    const run = lifecycle.beginRun(first)
    first.connId = 'changed'
    first.format = 'csv'
    first.sources[1].targetColl = 'changed'

    expect(run).toMatchObject({
      tabId: 'first',
      connectionId: 'c1',
      format: 'json',
      validate: true,
      sources: [
        { path: '/a.json', targetDb: 'db1', targetColl: 'people' },
        { path: '/b.json', targetDb: 'db1', targetColl: 'orders' },
      ],
    })
  })

  it('rejects completion from a run started by another tab', () => {
    const lifecycle = useImportPaneLifecycle()
    const first = tab('first', 'c1')
    const second = tab('second', 'c2')

    lifecycle.attach(first)
    const firstRun = lifecycle.beginRun(first)
    expect(lifecycle.isCurrentRun(firstRun, first)).toBe(true)

    lifecycle.attach(second)
    expect(lifecycle.isCurrentRun(firstRun, second)).toBe(false)
    expect(lifecycle.isCurrentRun(lifecycle.beginRun(second), second)).toBe(true)
  })
})

describe('import pane preview identity', () => {
  it('rejects an overtaken preview and previews from another tab', () => {
    const lifecycle = useImportPaneLifecycle()
    const first = tab('first', 'c1')
    const second = tab('second', 'c2')

    lifecycle.attach(first)
    const firstPreview = lifecycle.beginPreview(first, { path: '/a.json' })
    const newerPreview = lifecycle.beginPreview(first, { path: '/b.json' })
    expect(lifecycle.isCurrentPreview(firstPreview, first)).toBe(false)
    expect(lifecycle.isCurrentPreview(newerPreview, first)).toBe(true)

    lifecycle.cancelPreview()
    expect(lifecycle.isCurrentPreview(newerPreview, first)).toBe(false)

    lifecycle.attach(second)
    expect(lifecycle.isCurrentPreview(newerPreview, second)).toBe(false)
  })
})
