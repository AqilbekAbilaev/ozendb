import { ref, reactive, computed } from 'vue'
import { browseTable, countTable, updateRow } from '../api/queries'
import { listColumns } from '../api/resources'
import { errMessage } from '../../../utils/errors'
import { formatCell, cellKind } from './formatCell.js'
import { parseFilter } from './parseFilter.js'
import { buildSelectSql } from './buildSelectSql.js'
import { runSql } from './runSql.js'

const JSON_TYPES = ['json', 'jsonb']

/**
 * One table-browse tab's state: a page of rows, the row count, sorting, and editing a
 * cell by the row's primary key. `target` is `{ connectionId, schema, table }`.
 */
export function usePostgresTable(target, { pageSize = 100, readOnly = false } = {}) {
  const columns = ref([])
  const rows = ref([])
  const total = ref(null)
  const elapsedMs = ref(null)
  const offset = ref(0)
  const orderBy = ref(null)
  const descending = ref(false)
  const loading = ref(false)
  const error = ref(null)
  const editError = ref(null)
  // What each header box holds, by column, and the filters last applied from them:
  // typing edits the boxes, and only applying reloads.
  const filterText = ref({})
  const filters = ref([])
  // SQL mode: an editor seeded with the SQL the filters amount to. It can hand back
  // to the filters only while that SQL is untouched, since nothing reads SQL back.
  const mode = ref('filter')
  const sqlState = reactive({ connectionId: target.connectionId, sql: '', result: null, error: null, running: false })
  let builtSql = null
  // Column metadata (type, primary key) by name, fetched once.
  const columnInfo = ref({})
  // Only the latest load may write back: a sort clicked while a page is loading
  // must not be overwritten by that older page.
  let generation = 0

  const keyColumns = computed(() =>
    Object.values(columnInfo.value).filter(c => c.isPrimaryKey).map(c => c.name))
  const hasPrev = computed(() => offset.value > 0)
  const canUseFilters = computed(() => mode.value === 'filter' || sqlState.sql === builtSql)
  const activeFilters = computed(() => filters.value.length)
  const hasNext = computed(() => total.value != null && offset.value + pageSize < total.value)

  async function load() {
    const mine = ++generation
    loading.value = true
    error.value = null
    try {
      const [page, count, info] = await Promise.all([
        browseTable(target, { filters: filters.value, orderBy: orderBy.value, descending: descending.value, limit: pageSize, offset: offset.value }),
        total.value == null ? countTable(target, filters.value) : total.value,
        Object.keys(columnInfo.value).length ? null : listColumns(target),
      ])
      if (mine !== generation) return
      columns.value = page.columns
      rows.value = page.rows
      elapsedMs.value = page.elapsedMs
      total.value = count
      if (info) columnInfo.value = Object.fromEntries(info.map(c => [c.name, c]))
    } catch (e) {
      if (mine !== generation) return
      error.value = errMessage(e)
      rows.value = []
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  // Paging keeps the count; Refresh re-reads it, since rows may have changed elsewhere.
  function refresh() {
    total.value = null
    return load()
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

  function setFilterText(column, text) {
    filterText.value = { ...filterText.value, [column]: text }
  }

  // A new filter changes the row count, so it is re-read along with page one.
  function applyFilters() {
    filters.value = Object.entries(filterText.value).flatMap(([column, text]) => {
      const parsed = parseFilter(text, cellKind(columnInfo.value[column]?.dataType))
      return parsed ? [{ column, ...parsed }] : []
    })
    total.value = null
    return goTo(0)
  }

  function clearFilters() {
    filterText.value = {}
    return applyFilters()
  }

  function toSql() {
    builtSql = buildSelectSql({
      schema: target.schema,
      table: target.table,
      filters: filters.value,
      orderBy: orderBy.value ? [orderBy.value] : keyColumns.value,
      descending: descending.value,
      limit: pageSize,
      offset: offset.value,
    })
    sqlState.sql = builtSql
    mode.value = 'sql'
    return runSql(sqlState)
  }

  function toFilters() {
    if (canUseFilters.value) mode.value = 'filter'
  }

  // Arrays aren't editable yet: their text form (`{a,b}`) isn't what the grid shows.
  function canEdit(column) {
    const info = columnInfo.value[column]
    return !readOnly && keyColumns.value.length > 0 && !!info && !info.dataType.endsWith('[]')
  }

  // The editor's starting text: JSON columns as JSON (so a string keeps its quotes and
  // saving it unchanged parses back), everything else as displayed, NULL as empty.
  function editText(column, value) {
    if (JSON_TYPES.includes(columnInfo.value[column]?.dataType)) return value === null ? '' : JSON.stringify(value)
    return value === null ? '' : formatCell(value)
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
    columns, columnInfo, rows, total, elapsedMs, offset, orderBy, descending, loading, error, editError,
    filterText, activeFilters, mode, sqlState, canUseFilters, toSql, toFilters, hasPrev, hasNext, load, refresh, nextPage, prevPage, sortBy,
    setFilterText, applyFilters, clearFilters, canEdit, editText, saveCell,
  }
}
