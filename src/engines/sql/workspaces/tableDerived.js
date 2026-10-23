import { computed } from 'vue'
import { buildSelectSql, aliases } from './buildSelectSql.js'
import { columnRefs } from './columnRefs.js'
import { joinOffers as offersFor } from './joinOffers.js'
import { mergeColumnOrder } from '../../../composables/useColumnReorder'

// What a table tab's view works out from its state and runtime: column refs and info,
// the visible columns, the SQL the filters amount to, the joins on offer, paging flags.
// `t` is the tab's shared context (useSqlTable).
export function useTableDerived(t) {
  const { dialect, target, columns, rows, total, offset, limit, orderBy, descending, filters, shownColumns, columnOrder, mainColumns, joins, joinColumns, foreignKeys } = t
  // A column's cellKind, by the engine's rules. Every column in `refs` carries it as `kind`.
  const kindOf = (info) => dialect.cellKind(info?.dataType, info?.enumValues)
  const withKinds = (columns) => columns.map(info => ({ ...info, kind: kindOf(info) }))
  const refs = computed(() => columnRefs(mainColumns.value && joins.value.every(j => joinColumns.value[j.key])
    ? [{ key: '', columns: mainColumns.value }, ...joins.value.map(j => ({ key: j.key, columns: joinColumns.value[j.key] }))]
        .map(({ key, columns }) => ({ key, columns: withKinds(columns) }))
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
  // The shown columns (all, when none are chosen), in the order they were dragged into.
  const view = computed(() => {
    const ordered = mergeColumnOrder(shownColumns.value.length ? shownColumns.value : keys.value, columnOrder.value)
    if (ordered === keys.value) return { columns: ordered, rows: rows.value }
    const positions = ordered.map(at)
    return { columns: ordered, rows: rows.value.map(row => positions.map(i => row[i])) }
  })
  const currentSql = computed(() => buildSelectSql(dialect, {
    schema: target.schema,
    table: target.table,
    joins: wireJoins.value,
    columns: shownColumns.value.map(columnOf),
    filters: filters.value.map(({ key, ...filter }) => ({ ...columnOf(key), ...filter, dataType: refByKey.value[key].info.dataType })),
    orderBy: orderBy.value ? [columnOf(orderBy.value)] : keyColumns.value.map(column => ({ table: 0, column })),
    descending: descending.value,
    limit: limit.value,
    offset: offset.value,
  }))

  return { kindOf, refs, refByKey, tableNames, columnInfo, columnOf, wireFilters, wireJoins, joinOffers, keyColumns, hasPrev, activeFilters, hasNext, keys, at, view, currentSql }
}
