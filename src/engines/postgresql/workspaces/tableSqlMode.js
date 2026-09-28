import { readTableSelect } from '../api/queries'
import { listColumns } from '../api/resources'
import { errMessage } from '../../../utils/errors'
import { cellKind } from './formatCell.js'
import { filterBoxText } from './parseFilter.js'
import { runSql } from './runSql.js'

// A table tab's SQL mode: opening it on the SQL the filters amount to, and going back —
// reading edited SQL into the joins, boxes, sort and page, or saying why they can't show it.
export function useTableSqlMode(t) {
  const { target, runtime, total, limit, orderBy, descending, filterText, filters, shownColumns, mode, filterRefusal, sql, sqlRun, mainColumns, joins, joinColumns, nextJoinKey, pauses, refs, keyColumns, currentSql, loadForeignKeys, goTo } = t
  function toSql() {
    openSql(currentSql.value)
    return runSql(sqlRun, sql.value)
  }

  // Not run: SQL loaded from the library may change data.
  function openSql(text) {
    runtime.builtSql = currentSql.value
    sql.value = text
    filterRefusal.value = null
    mode.value = 'sql'
  }

  async function toFilters() {
    filterRefusal.value = null
    if (sql.value !== runtime.builtSql) {
      try {
        filterRefusal.value = await adopt(await readTableSelect(target, sql.value))
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
      key: nextJoinKey(), schema, table, kind, on,
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
    joinColumns.value = Object.fromEntries(nextJoins.map(j => [j.key, j.columns]))
    joins.value = nextJoins.map(({ columns: _, ...j }) => ({ ...j, on: j.on.map(p => ({ column: p.column, equals: keyOf(p.equals) })) }))
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

  return { toSql, openSql, toFilters }
}
