import { ref, reactive, computed } from 'vue'
import { browseTable, countTable, updateRow, readTableSelect, runQuery } from '../api/queries'
import { listColumns, listForeignKeys } from '../api/resources'
import { errMessage } from '../../../utils/errors'
import { formatCell, cellKind } from './formatCell.js'
import { parseFilter, filterBoxText } from './parseFilter.js'
import { buildSelectSql, aliases } from './buildSelectSql.js'
import { runSql, explainSql } from './runSql.js'
import { columnRefs } from './columnRefs.js'
import { joinOffers as offersFor } from './joinOffers.js'
import { useBuilderPauses } from './builderPauses.js'
import { createTableState } from './tableState.js'
import { tableErrorText } from './tableError.js'

const JSON_TYPES = ['json', 'jsonb']

/**
 * One table-browse tab's state: a page of rows, the row count, sorting, and editing a
 * cell by the row's primary key. `target` is `{ connectionId, schema, table }`;
 * `initial` is a table state to start from (tableState.js) — a tab restored after a restart.
 */
export function usePostgresTable(target, { pageSize = 100, readOnly = false, initial = createTableState({ limit: pageSize }) } = {}) {
  const saved = initial.query
  const columns = ref([])
  const rows = ref([])
  const total = ref(null)
  const elapsedMs = ref(null)
  const offset = ref(0)
  const limit = ref(saved.limit)
  // One entry per load, newest last: `{ at, ok, text, ms }`.
  const messages = ref([])
  // `{ version, encoding }` for the footer, read once; stays null if it can't be.
  const server = ref(null)
  const orderBy = ref(saved.orderBy)
  const descending = ref(saved.descending)
  const loading = ref(false)
  const error = ref(null)
  const editError = ref(null)
  // What each header box holds, by column, and the filters last applied from them:
  // typing edits the boxes, and only applying reloads.
  const filterText = ref(saved.filterText)
  // Applied filters as `{ key, op, value }`; sent with each column's table position.
  const filters = ref(saved.filters)
  // The columns the grid shows, in order; empty shows them all. Rows are still read
  // whole, so a hidden primary key can identify a row for editing.
  const shownColumns = ref(saved.shownColumns)
  // SQL mode: an editor seeded with the SQL the filters amount to. Going back reads
  // edited SQL into the boxes, or says why they can't show it.
  const mode = ref(initial.mode)
  const filterRefusal = ref(null)
  const sqlState = reactive({ connectionId: target.connectionId, sql: initial.sql, result: null, error: null, running: false })
  let builtSql = null
  // Filter mode's Explain: the plan for currentSql, kept like SQL mode's result.
  const explainState = reactive({ connectionId: target.connectionId, plan: null, planError: null, explaining: false })
  const explain = () => explainSql(explainState, currentSql.value)
  // The screen around the data — the Query Builder and the result sub-tab — kept with
  // the tab, since the workspace component is unmounted whenever another kind of tab shows.
  const panel = reactive({ builderOpen: false, builderWidth: 360, rtab: 'Result' })
  // The browsed table's column metadata (type, primary key), fetched once, and its
  // joins, each `{ key, schema, table, kind, on, columns }`: matched where every
  // `{ column, equals }` in `on` holds — its `column` equals the column keyed
  // `equals` — with its own columns' metadata (null until fetched, for a restored
  // join). A join's key never changes, so removing one leaves the others' columns keyed
  // as they were. Filters, sort, shown columns and edits name a column by its key (see
  // columnRefs.js).
  const mainColumns = ref(null)
  const joins = ref(saved.joins.map(j => ({ ...j, columns: null })))
  let joinCount = saved.nextJoin - 1
  // Foreign keys by `schema.table`, fetched as each table enters the tab.
  const foreignKeys = ref({})
  const refs = computed(() => columnRefs(mainColumns.value && joins.value.every(j => j.columns)
    ? [{ key: '', columns: mainColumns.value }, ...joins.value.map(j => ({ key: j.key, columns: j.columns }))]
    : []))
  const refByKey = computed(() => Object.fromEntries(refs.value.map(r => [r.key, r])))
  const tableNames = computed(() => aliases([target.table, ...joins.value.map(j => j.table)]))
  // With joins, each column's info also names its table, as the SQL does.
  const columnInfo = computed(() => Object.fromEntries(refs.value.map(r =>
    [r.key, joins.value.length ? { ...r.info, tableLabel: tableNames.value[r.table] } : r.info])))
  const columnOf = (key) => ({ table: refByKey.value[key].table, column: refByKey.value[key].name })
  const wireFilters = computed(() => filters.value.map(({ key, ...filter }) => ({ ...columnOf(key), ...filter })))
  const wireJoins = computed(() => joins.value.map(({ schema, table, kind, on }) =>
    ({ schema, table, kind, on: on.map(({ column, equals }) => ({ column, equals: columnOf(equals) })) })))
  const joinOffers = computed(() => offersFor(
    [{ key: '', schema: target.schema, table: target.table }, ...joins.value],
    foreignKeys.value,
  ))
  const pauses = useBuilderPauses({ shownColumns, orderBy, descending, setShownColumns, setSort })
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
      const missing = joins.value.filter(j => !j.columns)
      if (missing.length) {
        const lists = await Promise.all(missing.map(({ schema, table }) => listColumns({ connectionId: target.connectionId, schema, table })))
        if (mine !== generation) return
        joins.value = joins.value.map(j => (j.columns ? j : { ...j, columns: lists[missing.indexOf(j)] }))
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
      error.value = tableErrorText(e)
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

  async function addJoin({ schema, table, on }) {
    try {
      const columns = await listColumns({ connectionId: target.connectionId, schema, table })
      joins.value = [...joins.value, { key: `j${++joinCount}`, schema, table, kind: 'left', on, columns }]
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

  // What a join's pairs can match: its own columns, by name, and the keys of the
  // tables before it.
  function joinChoices(key) {
    const n = joins.value.findIndex(j => j.key === key) + 1
    return {
      own: joins.value[n - 1].columns.map(c => c.name),
      earlier: refs.value.filter(r => r.table < n).map(r => r.key),
    }
  }

  function setJoinOn(key, index, pair) {
    joins.value = joins.value.map(j => (j.key === key ? { ...j, on: j.on.map((p, i) => (i === index ? pair : p)) } : j))
    return reload()
  }

  // Removes the join and any join matched on its columns, with everything that
  // names their columns.
  function removeJoin(key) {
    const gone = new Set([key])
    const ownerOf = (columnKey) => joins.value[refByKey.value[columnKey].table - 1]?.key
    for (const j of joins.value) if (j.on.some(p => gone.has(ownerOf(p.equals)))) gone.add(j.key)
    const dropped = new Set(refs.value.filter(r => r.table && gone.has(joins.value[r.table - 1].key)).map(r => r.key))
    joins.value = joins.value.filter(j => !gone.has(j.key))
    filters.value = filters.value.filter(f => !dropped.has(f.key))
    filterText.value = Object.fromEntries(Object.entries(filterText.value).filter(([k]) => !dropped.has(k)))
    shownColumns.value = shownColumns.value.filter(k => !dropped.has(k))
    if (dropped.has(orderBy.value)) orderBy.value = null
    pauses.forget(dropped)
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
      const parsed = ref && parseFilter(text, cellKind(ref.info.dataType, ref.info.enumValues))
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
    openSql(currentSql.value)
    return runSql(sqlState)
  }

  // Not run: SQL loaded from the library may change data.
  function openSql(sql) {
    builtSql = currentSql.value
    sqlState.sql = sql
    filterRefusal.value = null
    mode.value = 'sql'
  }

  async function toFilters() {
    filterRefusal.value = null
    if (sqlState.sql !== builtSql) {
      try {
        filterRefusal.value = await adopt(await readTableSelect(target, sqlState.sql))
      } catch (e) {
        filterRefusal.value = errMessage(e)
      }
      if (filterRefusal.value) return
    }
    mode.value = 'filter'
  }

  // Takes SQL read back by the backend as the tab's joins, filters, sort and page, or
  // returns why the grid can't show it. Columns arrive as `{ table, column }`; the joins
  // are rebuilt, each with its columns fetched afresh.
  async function adopt({ joins: readJoins, columns: shown, filters: read, orderBy: order, descending: desc, limit: rowsPerPage, offset: at }) {
    if (rowsPerPage == null) return 'the filter view shows a page at a time, so it needs a LIMIT.'
    const nextJoins = await Promise.all(readJoins.map(async ({ schema, table, kind, on }) => ({
      key: `j${++joinCount}`, schema, table, kind, on,
      columns: await listColumns({ connectionId: target.connectionId, schema, table }),
    })))
    const keyOf = ({ table, column }) => (table ? `${nextJoins[table - 1].key}.${column}` : column)
    const infoOf = ({ table, column }) => (table ? nextJoins[table - 1].columns : mainColumns.value).find(c => c.name === column)
    const keys = keyColumns.value
    const byKey = order.length === keys.length && order.every((c, i) => !c.table && c.column === keys[i])
    if (order.length > 1 && !byKey) return 'the filter view sorts by one column at a time.'
    const texts = {}
    for (const f of read) {
      const key = keyOf(f)
      const text = filterBoxText(f, cellKind(infoOf(f)?.dataType, infoOf(f)?.enumValues))
      if (text == null || key in texts) return `the condition on "${f.column}" can't be typed in its filter box.`
      texts[key] = text
    }
    pauses.forget(new Set(refs.value.filter(r => r.table).map(r => r.key)))
    joins.value = nextJoins.map(j => ({ ...j, on: j.on.map(p => ({ column: p.column, equals: keyOf(p.equals) })) }))
    nextJoins.forEach(loadForeignKeys)
    filterText.value = texts
    filters.value = read.map(f => ({ key: keyOf(f), op: f.op, value: f.value }))
    shownColumns.value = shown.map(keyOf)
    orderBy.value = byKey ? null : order[0] ? keyOf(order[0]) : null
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
    return !readOnly && keyColumns.value.length > 0 && ref?.table === 0
  }

  // JSON and array columns are edited as JSON — arrays as the list the grid shows.
  const asJson = (column) => {
    const type = columnInfo.value[column]?.dataType ?? ''
    return JSON_TYPES.includes(type) || type.endsWith('[]')
  }

  // The editor's starting text: JSON (so a string keeps its quotes and saving it
  // unchanged parses back) where asJson, everything else as displayed, NULL as empty.
  function editText(column, value) {
    if (value === null) return ''
    return asJson(column) ? JSON.stringify(value) : formatCell(value)
  }

  // `text` null is the editor's Set NULL, never text to parse.
  function parseInput(column, text) {
    if (text === null || !asJson(column)) return text
    const isArray = columnInfo.value[column].dataType.endsWith('[]')
    let value
    try {
      value = JSON.parse(text)
    } catch {
      throw new Error(`"${column}" holds ${isArray ? 'a list' : 'JSON'}, and that isn't valid JSON.`)
    }
    if (isArray && !Array.isArray(value)) throw new Error(`"${column}" holds a list: write it like ["a", "b"].`)
    return value
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
    const state = createTableState()
    // The page and paused parts aren't saved yet: restoring them is a change of its own.
    state.query = {
      ...state.query,
      filterText: filterText.value, filters: filters.value, shownColumns: shownColumns.value,
      joins: joins.value.map(({ columns: _, ...j }) => j), nextJoin: joinCount + 1,
      orderBy: orderBy.value, descending: descending.value, limit: limit.value,
    }
    state.mode = mode.value
    state.sql = sqlState.sql
    return state
  }

  return {
    snapshot, explainState, explain, pauses, panel,
    columns, columnInfo, rows, total, elapsedMs, offset, orderBy, descending, loading, error, editError,
    filterText, activeFilters, mode, sqlState, filterRefusal, toSql, openSql, limit, messages, server, currentSql, toFilters, hasPrev, hasNext, load, refresh, nextPage, prevPage, sortBy,
    keys, joins, joinOffers, tableNames, addJoin, setJoinKind, removeJoin, joinChoices, setJoinOn,
    setFilterText, replaceFilterText, setSort, shownColumns, setShownColumns, view, applyFilters, clearFilters, canEdit, editText, saveCell,
  }
}
