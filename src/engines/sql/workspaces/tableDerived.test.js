import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const { useTableDerived } = await import('./tableDerived.js')
const { dialect } = await import('../../mysql/sql.js')

// A table tab's shared context, as useSqlTable builds it, with one filter set on `price ü`.
const tab = (filter) => ({
  dialect,
  target: { schema: 'shop ü', table: 'order items' },
  columns: ref([]), rows: ref([]), total: ref(null), offset: ref(0), limit: ref(50), orderBy: ref(null), descending: ref(false),
  filters: ref([{ key: 'price ü', ...filter }]),
  shownColumns: ref([]), columnOrder: ref([]),
  mainColumns: ref([{ name: 'price ü', dataType: 'decimal(10,2)', isPrimaryKey: true }]),
  joins: ref([]), joinColumns: ref({}), foreignKeys: ref([]),
})

describe('filters', () => {
  it('sends each filter to the backend by its table and column, without its type', () => {
    const { wireFilters } = useTableDerived(tab({ op: 'eq', value: '1.50' }))
    expect(wireFilters.value).toEqual([{ table: 0, column: 'price ü', op: 'eq', value: '1.50' }])
  })

  it('writes each filter into the SQL as its column type reads it', () => {
    const { currentSql } = useTableDerived(tab({ op: 'eq', value: '1.50' }))
    expect(currentSql.value).toContain('WHERE `price ü` = 1.50\n')
  })
})
