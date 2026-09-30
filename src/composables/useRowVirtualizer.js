import { ref, computed, nextTick } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

// Row virtualization for a result grid: only the rows in (and just beyond) the
// viewport are mounted, so a 10,000-row result costs about thirty rows of DOM.
// TanStack owns the scroll maths, overscan, viewport-resize handling and window
// updates; this owns the measured row height and the two spacer heights that reserve
// the scroll extent of what isn't mounted.
//
// The spacers are what let a plain <table> be virtualized at all — a sticky header and
// a row-number gutter keep working because the rows are still rows, just fewer of them.
//
// Shared by both engines' grids. `count`, `scrollElement` and `rowElement` are getters
// because the caller builds its row list further down its own setup than this is called.
export function useRowVirtualizer({ count, scrollElement, rowElement, estimate = 25, overscan = 12 }) {
  const rowH = ref(estimate)

  // Rows are uniform within one result (single line, one font), so one measurement is
  // exact and no per-row measuring is needed. Re-measured whenever the rows change,
  // since a different result can have a different row height (pills, editors).
  function measureRowH() {
    const tr = rowElement()
    if (!tr) return
    const h = tr.getBoundingClientRect().height
    if (h > 0 && Math.abs(h - rowH.value) > 0.25) rowH.value = h
  }

  const rowVirtualizer = useVirtualizer(computed(() => {
    const size = rowH.value   // read so the options object recomputes once it's measured
    return {
      count: count(),
      getScrollElement: () => scrollElement(),
      estimateSize: () => size,
      overscan,
    }
  }))

  const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())
  const totalSize = computed(() => rowVirtualizer.value.getTotalSize())
  const padTop = computed(() => (virtualRows.value.length ? virtualRows.value[0].start : 0))
  const padBottom = computed(() => {
    const rows = virtualRows.value
    return rows.length ? totalSize.value - rows[rows.length - 1].end : 0
  })

  const scrollToRow = (row, align = 'auto') => rowVirtualizer.value.scrollToIndex(row, { align })
  // After the rows on screen have changed: measure once they're painted.
  const remeasure = () => nextTick(measureRowH)

  return { rowH, virtualRows, padTop, padBottom, measureRowH, remeasure, scrollToRow, rowVirtualizer }
}
