import { ref, reactive, computed } from 'vue'
import { browseTable, countTable, updateRow, readTableSelect, runQuery } from '../api/queries'
import { listColumns } from '../api/resources'
import { errMessage } from '../../../utils/errors'
import { formatCell, cellKind } from './formatCell.js'
import { parseFilter, filterBoxText } from './parseFilter.js'
import { buildSelectSql } from './buildSelectSql.js'
import { runSql } from './runSql.js'
import { columnRefs } from './columnRefs.js'

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
  const limit = ref(pageSize)
  // One entry per load, newest last: `{ at, ok, text, ms }`.
  const messages = ref([])
  // `{ version, encoding }` for the footer, read once; stays null if it can't be.
  const server = ref(null)
  const orderBy = ref(null)
  const descending = ref(false)
  const loading = ref(false)
  const error = ref(null)
  const editError = ref(null)
  // What each header box holds, by column, and the filters last applied from them:
  // typing edits the boxes, and only applying reloads.
  const filterText = ref({})
  const filters = ref([])
  // The columns the grid shows, in order; empty shows them all. Rows are still read
  // whole, so a hidden primary key can identify a row for editing.
  const shownColumns = ref([])
  // SQL mode: an editor seeded with the SQL the filters amount to. Going back reads
  // edited SQL into the boxes, or says why they can't show it.
  const mode = ref('filter')
  const filterRefusal = ref(null)
  const sqlState = reactive({ connectionId: target.connectionId, sql: '', result: null, error: null, running: false })
  let builtSql = null
  // Each table's column metadata (type, primary key), the browsed table's first and
  // fetched once. Filters, sort, shown columns and edits name a column by its key
  // (see columnRefs.js).
  const tableColumns = ref([])
  const refs = computed(() => columnRefs(tableColumns.value.map((columns, i) => ({ key: i ? `j${i}` : '', columns }))))
  const refByKey = computed(() => Object.fromEntries(refs.value.map(r => [r.key, r])))
  const columnInfo = computed(() => Object.fromEntries(refs.value.map(r => [r.key, r.info])))
  const columnOf = (key) => ({ table: refByKey.value[key].table, column: refByKey.value[key].name })
  // Only the latest load may write back: a sort clicked while a page is loading
  // must not be overwritten by that older page.
  let generation = 0

  const keyColumns = computed(() => (tableColumns.value[0] ?? []).filter(c => c.isPrimaryKey).map(c => c.name))
  const hasPrev = computed(() => offset.value > 0)
  const activeFilters = computed(() => filters.value.length)
  const hasNext = computed(() => total.value != null && offset.value + limit.value < total.value)
  // Rows arrive in `refs` order, so a key's position is its value's place in a row.
  const keys = computed(() => (refs.value.length ? refs.value.map(r => r.key) : columns.value))
  const at = (key) => keys.value.indexOf(key)
  const view = computed(() => {
    if (!shownColumns.value.length) return { columns: keys.value, rows: rows.value }
    const positions = shownColumns.value.map(at)
    return { columns: shownColumns.value, rows: rows.value.map(row => positions.map(i => row[i])) }
  })
  const currentSql = computed(() => buildSelectSql({
    schema: target.schema,
    table: target.table,
    columns: shownColumns.value.map(key => refByKey.value[key].name),
    filters: filters.value,
    orderBy: orderBy.value ? [refByKey.value[orderBy.value].name] : keyColumns.value,
    descending: descending.value,
    limit: limit.value,
    offset: offset.value,
  }))

  function log(ok, text, ms) {
    messages.value = [...messages.value, { at: new Date(), ok, text, ms }]
  }

  function loadServer() {
    const sql = "SELECT current_setting('server_version'), current_setting('server_encoding')"
    runQuery(target.connectionId, sql)
      .then(({ rows: [[version, encoding]] }) => { server.value = { version, encoding } })
      .catch(() => {})
  }

  async function load() {
    const mine = ++generation
    loading.value = true
    error.value = null
    if (!server.value && mine === 1) loadServer()
    try {
      const [page, count, info] = await Promise.all([
        browseTable(target, {
          joins: [], filters: filters.value, orderBy: orderBy.value && columnOf(orderBy.value),
          descending: descending.value, limit: limit.value, offset: offset.value,
        }),
        total.value == null ? countTable(target, filters.value, []) : total.value,
        tableColumns.value.length ? null : listColumns(target),
      ])
      if (mine !== generation) return
      columns.value = page.columns
      rows.value = page.rows
      elapsedMs.value = page.elapsedMs
      total.value = count
      if (info) tableColumns.value = [info]
      log(true, `SELECT ${page.rows.length}`, page.elapsedMs)
    } catch (e) {
      if (mine !== generation) return
      error.value = errMessage(e)
      log(false, error.value)
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
  const nextPage = () => goTo(offset.value + limit.value)
  const prevPage = () => goTo(offset.value - limit.value)


  function setSort(column, desc) {
    orderBy.value = column
    descending.value = desc
    return goTo(0)
  }

  function sortBy(column) {
    descending.value = orderBy.value === column ? !descending.value : false
    orderBy.value = column
    return goTo(0)
  }

  function setFilterText(column, text) {
    filterText.value = { ...filterText.value, [column]: text }
  }

  function setShownColumns(list) {
    shownColumns.value = list
  }

  function replaceFilterText(texts) {
    filterText.value = texts
  }

  // A new filter changes the row count, so it is re-read along with page one. The
  // Limit box applies with the filters, as Run does both.
  function applyFilters(rowsPerPage = limit.value) {
    limit.value = rowsPerPage
    filters.value = Object.entries(filterText.value).flatMap(([key, text]) => {
      const ref = refByKey.value[key]
      const parsed = ref && parseFilter(text, cellKind(ref.info.dataType))
      return parsed ? [{ ...columnOf(key), ...parsed }] : []
    })
    total.value = null
    return goTo(0)
  }

  function clearFilters() {
    filterText.value = {}
    return applyFilters()
  }

  function toSql() {
    builtSql = currentSql.value
    sqlState.sql = builtSql
    filterRefusal.value = null
    mode.value = 'sql'
    return runSql(sqlState)
  }

  async function toFilters() {
    filterRefusal.value = null
    if (sqlState.sql !== builtSql) {
      try {
        filterRefusal.value = adopt(await readTableSelect(target, sqlState.sql))
      } catch (e) {
        filterRefusal.value = errMessage(e)
      }
      if (filterRefusal.value) return
    }
    mode.value = 'filter'
  }

  // Takes SQL read back by the backend as the grid's filters, sort and page, or
  // returns why the grid can't show it.
  function adopt({ columns: shown = [], filters: read, orderBy: order, descending: desc, limit: rowsPerPage, offset: at }) {
    if (rowsPerPage == null) return 'the filter view shows a page at a time, so it needs a LIMIT.'
    const keys = keyColumns.value
    const byKey = order.length === keys.length && order.every((c, i) => c === keys[i])
    if (order.length > 1 && !byKey) return 'the filter view sorts by one column at a time.'
    const texts = {}
    for (const f of read) {
      const text = filterBoxText(f, cellKind(columnInfo.value[f.column]?.dataType))
      if (text == null || f.column in texts) return `the condition on "${f.column}" can't be typed in its filter box.`
      texts[f.column] = text
    }
    filterText.value = texts
    filters.value = read.map(f => ({ ...f, table: 0 }))
    shownColumns.value = shown
    orderBy.value = byKey ? null : order[0] ?? null
    descending.value = desc
    limit.value = rowsPerPage
    total.value = null
    goTo(at)
    return null
  }

  // Only the browsed table's own cells are editable, by its primary key. Arrays aren't
  // editable yet: their text form (`{a,b}`) isn't what the grid shows.
  function canEdit(key) {
    const ref = refByKey.value[key]
    return !readOnly && keyColumns.value.length > 0 && ref?.table === 0 && !ref.info.dataType.endsWith('[]')
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

  async function saveCell(rowIndex, key, text) {
    editError.value = null
    const row = rows.value[rowIndex]
    try {
      const value = parseInput(key, text)
      // The browsed table's columns are keyed by their bare names.
      const where = keyColumns.value.map(name => ({ column: name, value: row[at(name)] }))
      const updated = await updateRow(target, [{ column: refByKey.value[key].name, value }], where)
      if (updated !== 1) {
        editError.value = 'That row changed or was deleted since it was loaded. Refresh and try again.'
        return false
      }
      row[at(key)] = value
      return true
    } catch (e) {
      editError.value = errMessage(e)
      return false
    }
  }

  return {
    columns, columnInfo, rows, total, elapsedMs, offset, orderBy, descending, loading, error, editError,
    filterText, activeFilters, mode, sqlState, filterRefusal, toSql, limit, messages, server, currentSql, toFilters, hasPrev, hasNext, load, refresh, nextPage, prevPage, sortBy,
    setFilterText, replaceFilterText, setSort, shownColumns, setShownColumns, view, applyFilters, clearFilters, canEdit, editText, saveCell,
  }
}
