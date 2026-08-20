import { describe, expect, it } from 'vitest'
import { useIndexPaneLifecycle } from './useIndexPaneLifecycle'

const tab = (id, connId = 'c1', dbName = 'db', collName = 'coll') => ({
  id, connId, dbName, collName,
})

describe('index pane menu ownership', () => {
  it('moves the menu API between reused index-tab instances', () => {
    const lifecycle = useIndexPaneLifecycle()
    const api = {}
    const first = tab('first')
    const second = tab('second', 'c2', 'other', 'items')

    lifecycle.attachMenuApi(first, api)
    expect(first._idxApi).toBe(api)

    lifecycle.attachMenuApi(second, api)
    expect(first._idxApi).toBeUndefined()
    expect(second._idxApi).toBe(api)

    lifecycle.detachMenuApi(api)
    expect(second._idxApi).toBeUndefined()
  })
})

describe('index form target', () => {
  it('captures an immutable target and clears it when the pane changes tabs', () => {
    const lifecycle = useIndexPaneLifecycle()
    const api = {}
    const first = tab('first')
    const second = tab('second', 'c2', 'other', 'items')

    lifecycle.attachMenuApi(first, api)
    const captured = lifecycle.captureFormTarget(first)
    first.collName = 'renamed-after-open'

    expect(captured).toEqual({ connectionId: 'c1', database: 'db', collection: 'coll' })
    expect(lifecycle.formTarget.value).toEqual(captured)

    lifecycle.attachMenuApi(second, api)
    expect(lifecycle.formTarget.value).toBeNull()
  })

  it('invalidates a form submission when the tab or form changes', () => {
    const lifecycle = useIndexPaneLifecycle()
    const api = {}
    const first = tab('first')
    const second = tab('second', 'c2', 'other', 'items')

    lifecycle.attachMenuApi(first, api)
    lifecycle.captureFormTarget(first)
    const firstSubmission = lifecycle.beginFormSubmit()
    expect(lifecycle.isCurrentFormSubmit(firstSubmission, first)).toBe(true)

    lifecycle.attachMenuApi(second, api)
    lifecycle.captureFormTarget(second)
    expect(lifecycle.isCurrentFormSubmit(firstSubmission, second)).toBe(false)

    const secondSubmission = lifecycle.beginFormSubmit()
    lifecycle.clearFormTarget()
    expect(lifecycle.isCurrentFormSubmit(secondSubmission, second)).toBe(false)
    expect(lifecycle.isTargetActive(secondSubmission.target, second)).toBe(true)
  })
})

describe('index load identity', () => {
  it('rejects requests overtaken by another load or tab switch', () => {
    const lifecycle = useIndexPaneLifecycle()
    const api = {}
    const first = tab('first')
    const second = tab('second', 'c2', 'other', 'items')

    lifecycle.attachMenuApi(first, api)
    const firstLoad = lifecycle.beginLoad(first)
    expect(lifecycle.isCurrentLoad(firstLoad, first)).toBe(true)

    const newerLoad = lifecycle.beginLoad(first)
    expect(lifecycle.isCurrentLoad(firstLoad, first)).toBe(false)
    expect(lifecycle.isCurrentLoad(newerLoad, first)).toBe(true)

    lifecycle.attachMenuApi(second, api)
    expect(lifecycle.isCurrentLoad(newerLoad, second)).toBe(false)
  })
})
