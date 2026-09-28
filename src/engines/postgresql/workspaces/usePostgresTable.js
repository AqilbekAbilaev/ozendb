import { toRef } from 'vue'
import { explainSql } from './runSql.js'
import { useTableDerived } from './tableDerived.js'
import { useTableLoad } from './tableLoad.js'
import { useTableQuery } from './tableQuery.js'
import { useTableSqlMode } from './tableSqlMode.js'
import { useTableEdit } from './tableEdit.js'

/**
 * One table-browse tab: a page of rows, the row count, sorting, and editing a cell by
 * the row's primary key. `tab` is the workspace: `{ connectionId, schema, table }`, and
 * the `state` and `ui` it keeps (tableState.js), which this reads and writes in place.
 */
export function usePostgresTable(tab, { readOnly = false } = {}) {
  const target = { connectionId: tab.connectionId, schema: tab.schema, table: tab.table }
  const query = tab.state.query
  const runtime = tab.runtime
  const columns = toRef(runtime, 'columns')
  const rows = toRef(runtime, 'rows')
  const total = toRef(runtime, 'total')
  const elapsedMs = toRef(runtime, 'elapsedMs')
  const offset = toRef(query, 'offset')
  const limit = toRef(query, 'limit')
  // One entry per load, newest last: `{ at, ok, text, ms }`.
  const messages = toRef(runtime, 'messages')
  // `{ version, encoding }` for the footer, read once; stays null if it can't be.
  const server = toRef(runtime, 'server')
  const orderBy = toRef(query, 'orderBy')
  const descending = toRef(query, 'descending')
  const loading = toRef(runtime, 'loading')
  const error = toRef(runtime, 'error')
  const editError = toRef(runtime, 'editError')
  // The grid's selected rows and cell; a load starts a fresh one.
  const selection = toRef(runtime, 'selection')
  // What each header box holds, by column, and the filters last applied from them:
  // typing edits the boxes, and only applying reloads.
  const filterText = toRef(query, 'filterText')
  // Applied filters as `{ key, op, value }`; sent with each column's table position.
  const filters = toRef(query, 'filters')
  // The columns the grid shows, in order; empty shows them all. Rows are still read
  // whole, so a hidden primary key can identify a row for editing.
  const shownColumns = toRef(query, 'shownColumns')
  const columnOrder = toRef(query, 'columnOrder')
  // SQL mode: an editor seeded with the SQL the filters amount to. Going back reads
  // edited SQL into the boxes, or says why they can't show it.
  const mode = toRef(tab.state, 'mode')
  const filterRefusal = toRef(runtime, 'filterRefusal')
  // SQL mode's text is lasting state; its runs aren't.
  const sql = toRef(tab.state, 'sql')
  const sqlRun = runtime.sqlRun
  // Filter mode's Explain: the plan for currentSql, kept like SQL mode's result.
  const explainRun = runtime.explainRun
  // The screen around the data — the Query Builder and the result sub-tab — kept with
  // the tab, since the workspace component is unmounted whenever another kind of tab shows.
  const panel = tab.ui
  // The browsed table's column metadata (type, primary key), fetched once, and its
  // joins, each `{ key, schema, table, kind, on }`: matched where every
  // `{ column, equals }` in `on` holds — its `column` equals the column keyed `equals`.
  // Each join's columns' metadata is fetched into `joinColumns` by key (none yet, for a
  // restored join). A join's key never changes, so removing one leaves the others'
  // columns keyed as they were. Filters, sort, shown columns and edits name a column by
  // its key (see columnRefs.js).
  const mainColumns = toRef(runtime, 'mainColumns')
  const joins = toRef(query, 'joins')
  const joinColumns = toRef(runtime, 'joinColumns')
  const nextJoinKey = () => `j${query.nextJoin++}`
  // Foreign keys by `schema.table`, fetched as each table enters the tab.
  const foreignKeys = toRef(runtime, 'foreignKeys')
  // The context every part of the tab reads: views onto the tab's state and runtime, and
  // what each part adds for the parts after it.
  const t = {
    target, runtime, columns, rows, total, elapsedMs, offset, limit, messages, server, orderBy, descending,
    loading, error, editError, filterText, filters, shownColumns, columnOrder, mode, filterRefusal, sql, sqlRun,
    mainColumns, joins, joinColumns, nextJoinKey, foreignKeys,
  }
  Object.assign(t, useTableDerived(t))
  Object.assign(t, useTableLoad(t))
  Object.assign(t, useTableQuery(t, tab.state.paused))
  Object.assign(t, useTableSqlMode(t))
  Object.assign(t, useTableEdit(t, readOnly))
  const explain = () => explainSql(explainRun, t.currentSql.value)

  return {
    explainRun, explain, panel, sql, sqlRun,
    columns, rows, total, elapsedMs, offset, orderBy, descending, loading, error, editError, selection,
    filterText, mode, filterRefusal, limit, messages, server, joins, shownColumns, columnOrder,
    ...pick(t, 'pauses', 'columnInfo', 'activeFilters', 'currentSql', 'hasPrev', 'hasNext', 'keys', 'joinOffers',
      'tableNames', 'view', 'toSql', 'openSql', 'toFilters', 'load', 'refresh', 'nextPage', 'prevPage', 'sortBy',
      'addJoin', 'setJoinKind', 'removeJoin', 'joinChoices', 'setJoinOn', 'setFilterText', 'replaceFilterText',
      'setSort', 'setShownColumns', 'moveColumn', 'applyFilters', 'clearFilters', 'canEdit', 'editText', 'saveCell'),
  }
}

const pick = (source, ...names) => Object.fromEntries(names.map(name => [name, source[name]]))
