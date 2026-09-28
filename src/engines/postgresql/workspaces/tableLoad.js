import { browseTable, countTable, runQuery } from '../api/queries'
import { listColumns, listForeignKeys } from '../api/resources'
import { tableErrorText } from './tableError.js'
import { createSelection } from '../../../composables/useRowSelection'

// Loading a table tab's page and count, and what the view fetches once: the server's
// version, and each table's foreign keys. Only the latest load may write back
// (runtime.generation): a sort clicked while a page is loading must not be overwritten
// by that older page.
export function useTableLoad(t) {
  const { target, runtime, columns, rows, total, elapsedMs, offset, limit, messages, server, orderBy, descending, loading, error, mainColumns, joins, joinColumns, foreignKeys, columnOf, wireFilters, wireJoins } = t
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
    const mine = ++runtime.generation
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
        if (mine !== runtime.generation) return
        mainColumns.value = info
      }
      const missing = joins.value.filter(j => !joinColumns.value[j.key])
      if (missing.length) {
        const lists = await Promise.all(missing.map(({ schema, table }) => listColumns({ connectionId: target.connectionId, schema, table })))
        if (mine !== runtime.generation) return
        joinColumns.value = { ...joinColumns.value, ...Object.fromEntries(missing.map((j, i) => [j.key, lists[i]])) }
      }
      const [page, count] = await Promise.all([
        browseTable(target, {
          joins: wireJoins.value, filters: wireFilters.value, orderBy: orderBy.value && columnOf(orderBy.value),
          descending: descending.value, limit: limit.value, offset: offset.value,
        }),
        total.value == null ? countTable(target, wireFilters.value, wireJoins.value) : total.value,
      ])
      if (mine !== runtime.generation) return
      columns.value = page.columns
      rows.value = page.rows
      runtime.selection = createSelection()
      elapsedMs.value = page.elapsedMs
      total.value = count
      log(true, `SELECT ${page.rows.length}`, page.elapsedMs)
    } catch (e) {
      if (mine !== runtime.generation) return
      error.value = tableErrorText(e)
      log(false, error.value)
      rows.value = []
      runtime.selection = createSelection()
    } finally {
      if (mine === runtime.generation) loading.value = false
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

  return { loadForeignKeys, load, refresh, goTo, nextPage, prevPage, reload }
}
