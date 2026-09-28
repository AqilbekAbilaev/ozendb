import { describe, it, expect, vi } from 'vitest'
import { ref, reactive } from 'vue'
import { useBuilderPauses } from './builderPauses.js'

function setup({ shown = [], orderBy = null, descending = false } = {}) {
  const table = { shownColumns: ref(shown), orderBy: ref(orderBy), descending: ref(descending) }
  table.setShownColumns = vi.fn(list => { table.shownColumns.value = list })
  table.setSort = vi.fn((column, desc) => { table.orderBy.value = column; table.descending.value = desc })
  const paused = reactive({ conditions: {}, columns: null, sort: null })
  return { table, paused, pauses: useBuilderPauses(table, paused) }
}

describe('Query Builder pauses', () => {
  it('switches the shown columns off and back on without losing them', () => {
    const { table, pauses } = setup({ shown: ['id', 'name'] })
    pauses.toggleColumns()
    expect(table.shownColumns.value).toEqual([])
    expect(pauses.columnsOn.value).toBe(false)
    pauses.toggleColumns()
    expect(table.shownColumns.value).toEqual(['id', 'name'])
    expect(pauses.columnsOn.value).toBe(true)
  })

  it('switches the sort off and back on, direction included', () => {
    const { table, pauses } = setup({ orderBy: 'name', descending: true })
    pauses.toggleSort()
    expect(table.setSort).toHaveBeenLastCalledWith(null, false)
    expect(pauses.sortOn.value).toBe(false)
    pauses.toggleSort()
    expect(table.setSort).toHaveBeenLastCalledWith('name', true)
    expect(pauses.sortOn.value).toBe(true)
  })

  it('has nothing to switch off while nothing is set', () => {
    const { table, pauses } = setup()
    pauses.toggleColumns()
    pauses.toggleSort()
    expect(table.setShownColumns).not.toHaveBeenCalled()
    expect(table.setSort).not.toHaveBeenCalled()
    expect(pauses.columnsOn.value).toBe(true)
    expect(pauses.sortOn.value).toBe(true)
  })

  it('counts as on again once the grid sets what was paused', () => {
    const { table, pauses } = setup({ orderBy: 'name', shown: ['id'] })
    pauses.toggleSort()
    pauses.toggleColumns()
    table.orderBy.value = 'id'
    table.shownColumns.value = ['name']
    expect(pauses.sortOn.value).toBe(true)
    expect(pauses.columnsOn.value).toBe(true)
  })

  it('forgets paused parts naming columns that left the tab', () => {
    const { pauses } = setup({ orderBy: 'j1.name', shown: ['id', 'j1.name'] })
    pauses.conditions.value = { 'j1.name': 'ad', id: '>1' }
    pauses.toggleSort()
    pauses.toggleColumns()
    pauses.forget(new Set(['j1.name']))
    expect(pauses.conditions.value).toEqual({ id: '>1' })
    expect(pauses.sortOn.value).toBe(true)
    pauses.toggleColumns()
    expect(pauses.columnsOn.value).toBe(true)
  })
})

describe('where pauses are kept', () => {
  it('in the paused part of the tab\'s state, so they go wherever the state goes', () => {
    const { paused, pauses } = setup({ orderBy: 'name', shown: ['id'] })
    pauses.toggleSort()
    pauses.toggleColumns()
    pauses.conditions.value = { id: '>1' }
    expect(paused).toEqual({ conditions: { id: '>1' }, columns: ['id'], sort: { column: 'name', desc: false } })
  })
})
