import { listColumns } from '../api/resources'
import { errMessage } from '../../../utils/errors'
import { cellKind } from './formatCell.js'
import { parseFilter } from './parseFilter.js'
import { useBuilderPauses } from './builderPauses.js'

// Changing what a table tab asks for: its joins, filters, sort and shown columns, and
// the Query Builder's pauses over them.
export function useTableQuery(t, paused) {
  const { target, total, limit, orderBy, descending, error, filterText, filters, shownColumns, joins, joinColumns, nextJoinKey, refs, refByKey, loadForeignKeys, goTo, reload } = t
  const pauses = useBuilderPauses({ shownColumns, orderBy, descending, setShownColumns, setSort }, paused)

  async function addJoin({ schema, table, on }) {
    try {
      const columns = await listColumns({ connectionId: target.connectionId, schema, table })
      const key = nextJoinKey()
      joinColumns.value = { ...joinColumns.value, [key]: columns }
      joins.value = [...joins.value, { key, schema, table, kind: 'left', on }]
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
      own: joinColumns.value[key].map(c => c.name),
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

  return { pauses, addJoin, setJoinKind, joinChoices, setJoinOn, removeJoin, setSort, sortBy, setFilterText, setShownColumns, replaceFilterText, applyFilters, clearFilters }
}
