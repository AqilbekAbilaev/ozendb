import { ref, computed } from 'vue'
import { browseTable, countTable, updateRow } from '../api/queries'
import { listColumns } from '../api/resources'
import { errMessage } from '../../../utils/errors'

const JSON_TYPES = ['json', 'jsonb']

/**
 * One table-browse tab's state: a page of rows, the row count, sorting, and editing a
 * cell by the row's primary key. `target` is `{ connectionId, schema, table }`.
 */
export function usePostgresTable(target, { pageSize = 100 } = {}) {
  const columns = ref([])
  const rows = ref([])
  const total = ref(null)
  const offset = ref(0)
  const orderBy = ref(null)
  const descending = ref(false)
  const loading = ref(false)
  const error = ref(null)
  const editError = ref(null)
  // Column metadata (type, primary key) by name, fetched once.
  const columnInfo = ref({})

  const keyColumns = computed(() =>
    Object.values(columnInfo.value).filter(c => c.isPrimaryKey).map(c => c.name))
  const hasPrev = computed(() => offset.value > 0)
  const hasNext = computed(() => total.value != null && offset.value + pageSize < total.value)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const [page, count, info] = await Promise.all([
        browseTable(target, { orderBy: orderBy.value, descending: descending.value, limit: pageSize, offset: offset.value }),
        total.value == null ? countTable(target) : total.value,
        Object.keys(columnInfo.value).length ? null : listColumns(target),
      ])
      columns.value = page.columns
      rows.value = page.rows
      total.value = count
      if (info) columnInfo.value = Object.fromEntries(info.map(c => [c.name, c]))
    } catch (e) {
      error.value = errMessage(e)
      rows.value = []
    } finally {
      loading.value = false
    }
  }

  function goTo(nextOffset) {
    offset.value = Math.max(0, nextOffset)
    return load()
  }
  const nextPage = () => goTo(offset.value + pageSize)
  const prevPage = () => goTo(offset.value - pageSize)

  function sortBy(column) {
    descending.value = orderBy.value === column ? !descending.value : false
    orderBy.value = column
    return goTo(0)
  }

  // Arrays aren't editable yet: their text form (`{a,b}`) isn't what the grid shows.
  function canEdit(column) {
    const info = columnInfo.value[column]
    return keyColumns.value.length > 0 && !!info && !info.dataType.endsWith('[]')
  }

  function parseInput(column, text) {
    if (!JSON_TYPES.includes(columnInfo.value[column].dataType)) return text
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`"${column}" holds JSON, and that isn't valid JSON.`)
    }
  }

  async function saveCell(rowIndex, column, text) {
    editError.value = null
    const row = rows.value[rowIndex]
    const at = (name) => columns.value.indexOf(name)
    try {
      const value = parseInput(column, text)
      const where = keyColumns.value.map(key => ({ column: key, value: row[at(key)] }))
      const updated = await updateRow(target, [{ column, value }], where)
      if (updated !== 1) {
        editError.value = 'That row changed or was deleted since it was loaded. Refresh and try again.'
        return false
      }
      row[at(column)] = value
      return true
    } catch (e) {
      editError.value = errMessage(e)
      return false
    }
  }

  return {
    columns, rows, total, offset, orderBy, descending, loading, error, editError,
    hasPrev, hasNext, load, nextPage, prevPage, sortBy, canEdit, saveCell,
  }
}
