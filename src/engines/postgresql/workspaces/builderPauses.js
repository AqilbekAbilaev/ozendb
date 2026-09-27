import { ref, computed } from 'vue'

// Query Builder parts switched off without being lost, as its checkboxes do:
// conditions (filter-box text by column key, kept out of the boxes), the shown columns,
// and the sort. A part counts as on again once the grid sets it anew.
export function useBuilderPauses({ shownColumns, orderBy, descending, setShownColumns, setSort }) {
  const conditions = ref({})
  const columns = ref(null)
  const sort = ref(null)

  const columnsOn = computed(() => shownColumns.value.length > 0 || !columns.value)
  const sortOn = computed(() => orderBy.value != null || !sort.value)

  function toggleColumns() {
    if (!columnsOn.value) {
      setShownColumns(columns.value)
      columns.value = null
    } else if (shownColumns.value.length) {
      columns.value = shownColumns.value
      setShownColumns([])
    }
  }

  function toggleSort() {
    if (!sortOn.value) {
      const { column, desc } = sort.value
      sort.value = null
      return setSort(column, desc)
    }
    if (orderBy.value != null) {
      sort.value = { column: orderBy.value, desc: descending.value }
      return setSort(null, false)
    }
  }

  // `keys` are columns that left the tab with a removed join.
  function forget(keys) {
    conditions.value = Object.fromEntries(Object.entries(conditions.value).filter(([k]) => !keys.has(k)))
    if (columns.value) columns.value = columns.value.filter(k => !keys.has(k))
    if (!columns.value?.length) columns.value = null
    if (keys.has(sort.value?.column)) sort.value = null
  }

  return { conditions, columnsOn, sortOn, toggleColumns, toggleSort, forget }
}
