import { computed } from 'vue'
import { buildSelectSql, aliases } from './buildSelectSql.js'
import { columnRefs } from './columnRefs.js'
import { joinOffers as offersFor } from './joinOffers.js'

// What a table tab's view works out from its state and runtime: column refs and info,
// the visible columns, the SQL the filters amount to, the joins on offer, paging flags.
// `t` is the tab's shared context (usePostgresTable).
export function useTableDerived(t) {
  const { target, columns, rows, total, offset, limit, orderBy, descending, filters, shownColumns, mainColumns, joins, joinColumns, foreignKeys } = t
  const refs = computed(() => columnRefs(mainColumns.value && joins.value.every(j => joinColumns.value[j.key])
    ? [{ key: '', columns: mainColumns.value }, ...joins.value.map(j => ({ key: j.key, columns: joinColumns.value[j.key] }))]
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

  return { refs, refByKey, tableNames, columnInfo, columnOf, wireFilters, wireJoins, joinOffers, keyColumns, hasPrev, activeFilters, hasNext, keys, at, view, currentSql }
}
