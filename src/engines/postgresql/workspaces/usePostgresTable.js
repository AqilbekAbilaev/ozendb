import { ref, reactive, computed } from 'vue'
import { browseTable, countTable, updateRow, readTableSelect, runQuery } from '../api/queries'
import { listColumns, listForeignKeys } from '../api/resources'
import { errMessage } from '../../../utils/errors'
import { formatCell, cellKind } from './formatCell.js'
import { parseFilter, filterBoxText } from './parseFilter.js'
import { buildSelectSql, aliases } from './buildSelectSql.js'
import { runSql } from './runSql.js'
import { columnRefs } from './columnRefs.js'
import { joinOffers as offersFor } from './joinOffers.js'

const JSON_TYPES = ['json', 'jsonb']

/**
 * One table-browse tab's state: a page of rows, the row count, sorting, and editing a
 * cell by the row's primary key. `target` is `{ connectionId, schema, table }`.
 */
// `initial` is a snapshot() to start from — a tab restored after a restart.
export function usePostgresTable(target, { pageSize = 100, readOnly = false, initial = {} } = {}) {
  const columns = ref([])
  const rows = ref([])
  const total = ref(null)
  const elapsedMs = ref(null)
  const offset = ref(0)
  const limit = ref(initial.limit ?? pageSize)
  // One entry per load, newest last: `{ at, ok, text, ms }`.
  const messages = ref([])
  // `{ version, encoding }` for the footer, read once; stays null if it can't be.
  const server = ref(null)
  const orderBy = ref(initial.orderBy ?? null)
  const descending = ref(initial.descending ?? false)
  const loading = ref(false)
  const error = ref(null)
  const editError = ref(null)
  // What each header box holds, by column, and the filters last applied from them:
  // typing edits the boxes, and only applying reloads.
  const filterText = ref(initial.filterText ?? {})
  // Applied filters as `{ key, op, value }`; sent with each column's table position.
  const filters = ref(initial.filters ?? [])
  // The columns the grid shows, in order; empty shows them all. Rows are still read
  // whole, so a hidden primary key can identify a row for editing.
  const shownColumns = ref(initial.shownColumns ?? [])
  // SQL mode: an editor seeded with the SQL the filters amount to. Going back reads
  // edited SQL into the boxes, or says why they can't show it.
  const mode = ref(initial.mode ?? 'filter')
  const filterRefusal = ref(null)
  const sqlState = reactive({ connectionId: target.connectionId, sql: initial.sql ?? '', result: null, error: null, running: false })
  let builtSql = null
  // The browsed table's column metadata (type, primary key), fetched once, and its
  // joins, each `{ key, schema, table, kind, column, equals, columns }`: matched where
  // its `column` equals the column keyed `equals`, with its own columns' metadata. A
  // join's key never changes, so removing one leaves the others' columns keyed as
  // they were. Filters, sort, shown columns and edits name a column by its key (see
  // columnRefs.js).
  const mainColumns = ref(null)
  const joins = ref(initial.joins ?? [])
  let joinCount = Math.max(0, ...joins.value.map(j => Number(j.key.slice(1))))
  // Foreign keys by `schema.table`, fetched as each table enters the tab.
  const foreignKeys = ref({})
  const refs = computed(() => columnRefs(mainColumns.value
    ? [{ key: '', columns: mainColumns.value }, ...joins.value.map(j => ({ key: j.key, columns: j.columns }))]
    : []))
  const refByKey = computed(() => Object.fromEntries(refs.value.map(r => [r.key, r])))
  const tableNames = computed(() => aliases([target.table, ...joins.value.map(j => j.table)]))
  // With joins, each column's info also names its table, as the SQL does.
  const columnInfo = computed(() => Object.fromEntries(refs.value.map(r =>
    [r.key, joins.value.length ? { ...r.info, tableLabel: tableNames.value[r.table] } : r.info])))
  const columnOf = (key) => ({ table: refByKey.value[key].table, column: refByKey.value[key].name })
  const wireFilters = computed(() => filters.value.map(({ key, ...filter }) => ({ ...columnOf(key), ...filter })))
  const wireJoins = computed(() => joins.value.map(({ schema, table, kind, column, equals }) =>
    ({ schema, table, kind, column, equals: columnOf(equals) })))
  const joinOffers = computed(() => offersFor(
    [{ key: '', schema: target.schema, table: target.table }, ...joins.value],
    foreignKeys.value,
  ))
  // Only the latest load may write back: a sort clicked while a page is loading
  // must not be overwritten by that older page.
  let generation = 0

  const keyColumns = computed(() => (mainColumns.value ?? []).filter(c => c.isPrimaryKey).map(c => c.name))
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
    joins: wireJoins.value,
    columns: shownColumns.value.map(columnOf),
    filters: wireFilters.value,
    orderBy: orderBy.value ? [columnOf(orderBy.value)] : keyColumns.value.map(column => ({ table: 0, column })),
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

  function loadForeignKeys({ schema, table }) {
    listForeignKeys({ connectionId: target.connectionId, schema, table })
      .then(list => { foreignKeys.value = { ...foreignKeys.value, [`${schema}.${table}`]: list } })
      .catch(() => {})
  }

  async function load() {
    const mine = ++generation
    loading.value = true
    error.value = null
    if (mine === 1) {
      loadServer()
      loadForeignKeys(target)
    }
    try {
      // Filters, sort and joins name columns by key, which needs the table's columns:
      // a restored tab has them before it has ever loaded.
      if (!mainColumns.value) {
        const info = await listColumns(target)
        if (mine !== generation) return
        mainColumns.value = info
      }
      const [page, count] = await Promise.all([
        browseTable(target, {
          joins: wireJoins.value, filters: wireFilters.value, orderBy: orderBy.value && columnOf(orderBy.value),
          descending: descending.value, limit: limit.value, offset: offset.value,
        }),
        total.value == null ? countTable(target, wireFilters.value, wireJoins.value) : total.value,
      ])
      if (mine !== generation) return
      columns.value = page.columns
      rows.value = page.rows
      elapsedMs.value = page.elapsedMs
      total.value = count
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


  // A new join changes the rows and their count, so both are re-read from page one.
  function reload() {
    total.value = null
    return goTo(0)
  }

  async function addJoin({ schema, table, column, equals }) {
    try {
      const columns = await listColumns({ connectionId: target.connectionId, schema, table })
      joins.value = [...joins.value, { key: `j${++joinCount}`, schema, table, kind: 'left', column, equals, columns }]
    } catch (e) {
      error.value = errMessage(e)
      return
    }
    loadForeignKeys({ schema, table })
    return reload()
  }

  function setJoinKind(key, kind) {
    joins.value = joins.value.map(j => (j.key === key ? { ...j, kind } : j))
    return reload()
  }

  // Removes the join and any join matched on its columns, with everything that
  // names their columns.
  function removeJoin(key) {
    const gone = new Set([key])
    const ownerOf = (columnKey) => joins.value[refByKey.value[columnKey].table - 1]?.key
    for (const j of joins.value) if (gone.has(ownerOf(j.equals))) gone.add(j.key)
    const dropped = new Set(refs.value.filter(r => r.table && gone.has(joins.value[r.table - 1].key)).map(r => r.key))
    joins.value = joins.value.filter(j => !gone.has(j.key))
    filters.value = filters.value.filter(f => !dropped.has(f.key))
    filterText.value = Object.fromEntries(Object.entries(filterText.value).filter(([k]) => !dropped.has(k)))
    shownColumns.value = shownColumns.value.filter(k => !dropped.has(k))
    if (dropped.has(orderBy.value)) orderBy.value = null
    return reload()
  }

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
      return parsed ? [{ key, ...parsed }] : []
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
    if (sqlState.sql !== builtSql && joins.value.length) {
      filterRefusal.value = 'SQL with joins can\'t be read back into the filters yet.'
      return
    }
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
    filters.value = read.map(({ column, op, value }) => ({ key: column, op, value }))
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

  // What a restart brings back: the tab's settings, never its rows or results.
  function snapshot() {
    return {
      mode: mode.value, sql: sqlState.sql, limit: limit.value,
      filterText: filterText.value, filters: filters.value, shownColumns: shownColumns.value,
      orderBy: orderBy.value, descending: descending.value, joins: joins.value,
    }
  }

  return {
    snapshot,
    columns, columnInfo, rows, total, elapsedMs, offset, orderBy, descending, loading, error, editError,
    filterText, activeFilters, mode, sqlState, filterRefusal, toSql, limit, messages, server, currentSql, toFilters, hasPrev, hasNext, load, refresh, nextPage, prevPage, sortBy,
    keys, joins, joinOffers, tableNames, addJoin, setJoinKind, removeJoin,
    setFilterText, replaceFilterText, setSort, shownColumns, setShownColumns, view, applyFilters, clearFilters, canEdit, editText, saveCell,
  }
}
