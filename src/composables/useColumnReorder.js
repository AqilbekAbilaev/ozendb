import { ref, computed, onUnmounted } from 'vue'

// Drag-to-reorder for a result grid's column headers. WKWebView doesn't fire HTML5 drag/drop
// reliably, so the gesture is built from raw mouse events: a drag only begins past a small
// threshold (so a plain click still selects / sends the field to the VQB), an insertion line
// marks the drop point, and the grid auto-scrolls when the pointer nears a horizontal edge.
// Where the order is kept is the grid's business: it gets `moveColumn(col, insertBefore)`.

const DRAG_THRESHOLD  = 5    // px the pointer must travel before a press becomes a drag
const AUTOSCROLL_EDGE = 48   // px from an edge within which the grid auto-scrolls
const AUTOSCROLL_MIN  = 4    // px/frame at the zone's inner edge
const AUTOSCROLL_MAX  = 48   // px/frame cap (speed ramps with depth, faster the farther out)

// Merge a user-defined column order over the derived list: keep the user's order for columns
// still present, drop any that vanished, and append newly-appeared columns in derived position.
// `order` may be null/undefined (no custom order yet) → the derived list is returned unchanged.
export function mergeColumnOrder(derived, order) {
  if (!order) return derived
  const present = new Set(derived)
  const ordered = order.filter((col) => present.has(col))
  const known   = new Set(ordered)
  const extras  = derived.filter((col) => !known.has(col))
  return [...ordered, ...extras]
}

// Return a new order with `col` moved to sit before position `insertBefore` (cols.length drops
// it at the end). Removing the column first shifts later indices, hence the adjustment.
export function moveInOrder(cols, col, insertBefore) {
  const next = [...cols]
  const from = next.indexOf(col)
  if (from < 0) return next
  next.splice(from, 1)
  next.splice(from < insertBefore ? insertBefore - 1 : insertBefore, 0, col)
  return next
}

// Given the header rects (viewport getBoundingClientRects, in column order) and a pointer x,
// return the index the dragged column would be inserted before (0..rects.length), or -1 when
// the pointer maps to no column.
export function findDropIndex(x, rects) {
  if (!rects.length) return -1
  if (x < rects[0].rect.left) return 0
  if (x >= rects[rects.length - 1].rect.right) return rects.length
  for (const r of rects) {
    if (x >= r.rect.left && x < r.rect.right) {
      return x < r.rect.left + r.rect.width / 2 ? r.index : r.index + 1
    }
  }
  return -1
}

// A MongoDB grid's column order: kept on the tab per drill path, since a nested object's
// columns aren't the root's, so reordering while drilled never clobbers the root order.
export function useDrillColumnOrder({
  activeTab,        // () => the active tab object (holds the persisted `colOrder`)
  drillPath,        // () => the current drill path (array)
  derivedColumns,   // computed<string[]> — the auto-derived column list before user ordering
}) {
  // Empty key ('') is the root level.
  const pathKey = () => drillPath().join('\x00')

  const gridColumns = computed(() =>
    mergeColumnOrder(derivedColumns.value, activeTab()?.colOrder?.[pathKey()]))

  function moveColumn(col, insertBefore) {
    const tab = activeTab()
    if (!tab) return
    if (!tab.colOrder) tab.colOrder = {}
    tab.colOrder[pathKey()] = moveInOrder(gridColumns.value, col, insertBefore)
  }

  return { gridColumns, moveColumn }
}

export function useColumnReorder({
  columns,          // () => the columns in the order the header shows them
  moveColumn,       // (col, insertBefore) => keep the new order
  tableRef,         // ref to the <table> (to locate header cells)
  gridWrapRef,      // ref to the scroll container (for auto-scroll + indicator bounds)
  headerLabel,      // (col) => display label, used for the drag ghost
  onBeforePress,    // optional: run before preventDefault on mousedown (e.g. commit inline edit)
  onReordered,      // optional: called after a real reorder drag (e.g. swallow the trailing click)
}) {
  const pressed       = ref(false)  // mousedown → release: drives the `grabbing` cursor
  const dragging      = ref(false)  // past the drag threshold: drives the ghost
  const dropIndicator = ref(null)   // { left, top, height } | null
  const ghost         = ref({ x: 0, y: 0, label: '' })

  let col = null
  let startX = 0
  let startY = 0
  let lastX = 0
  let autoScrollDir = 0
  let autoScrollRAF = null

  // Data headers follow the row-number header, so column i is child i + 2.
  function headerRects() {
    const table = tableRef.value
    if (!table) return []
    const out = []
    for (let i = 0; i < columns().length; i++) {
      const th = table.querySelector(`thead th:nth-child(${i + 2})`)
      if (th) out.push({ index: i, rect: th.getBoundingClientRect() })
    }
    return out
  }

  // Position the insertion line at pointer x, spanning the full scroll-container height. A
  // boundary scrolled off-screen sits at a viewport-x outside the grid; the line is
  // position:fixed and unclipped, so clamp it to the container or it draws over neighbours.
  function updateDropIndicator(x) {
    const rects = headerRects()
    const idx   = findDropIndex(x, rects)
    const wrap  = gridWrapRef.value?.getBoundingClientRect()
    if (idx >= 0 && rects.length && wrap) {
      const raw = idx === 0 ? rects[0].rect.left
        : idx >= rects.length ? rects[rects.length - 1].rect.right
        : rects[idx].rect.left
      dropIndicator.value = {
        left: Math.max(wrap.left, Math.min(wrap.right, raw)),
        top: wrap.top,
        height: wrap.height,
      }
    } else {
      dropIndicator.value = null
    }
  }

  // Scroll horizontally while the pointer sits in an edge zone; speed ramps with how far past
  // the edge it is (faster the farther out), up to a cap. The rAF loop keeps running — even for
  // a stationary pointer — until the pointer leaves the zone or the drag ends.
  function updateAutoScroll(x) {
    const wrap = gridWrapRef.value?.getBoundingClientRect()
    if (!wrap) { autoScrollDir = 0; return }
    const speed = (d) => Math.min(AUTOSCROLL_MAX, Math.max(AUTOSCROLL_MIN, Math.round(d / 3)))
    if (x < wrap.left + AUTOSCROLL_EDGE) autoScrollDir = -speed(wrap.left + AUTOSCROLL_EDGE - x)
    else if (x > wrap.right - AUTOSCROLL_EDGE) autoScrollDir = speed(x - (wrap.right - AUTOSCROLL_EDGE))
    else autoScrollDir = 0
    if (autoScrollDir !== 0 && autoScrollRAF === null) autoScrollRAF = requestAnimationFrame(autoScrollTick)
  }

  function autoScrollTick() {
    autoScrollRAF = null
    if (autoScrollDir === 0 || !dragging.value || !gridWrapRef.value) return
    gridWrapRef.value.scrollLeft += autoScrollDir
    updateDropIndicator(lastX)  // columns shifted under a possibly-stationary pointer
    autoScrollRAF = requestAnimationFrame(autoScrollTick)
  }

  function stopAutoScroll() {
    if (autoScrollRAF !== null) { cancelAnimationFrame(autoScrollRAF); autoScrollRAF = null }
    autoScrollDir = 0
  }

  function onMove(e) {
    if (!dragging.value) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return
      dragging.value = true
    }
    lastX = e.clientX
    ghost.value = { x: e.clientX, y: e.clientY, label: headerLabel(col) }
    updateDropIndicator(e.clientX)
    updateAutoScroll(e.clientX)
  }

  function onUp(e) {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    stopAutoScroll()
    pressed.value = false
    document.body.style.cursor = ''
    if (dragging.value && col) {
      const insertBefore = findDropIndex(e.clientX, headerRects())
      if (insertBefore >= 0) moveColumn(col, insertBefore)
      if (onReordered) onReordered()
    }
    col = null
    dragging.value = false
    dropIndicator.value = null
  }

  // mousedown on a header cell starts a potential reorder. Skips the resize handle and a
  // header's input (a filter box, which the preventDefault below would keep from focusing);
  // commits any open inline edit before preventDefault (which would otherwise swallow the
  // editor's blur).
  function onHeaderMouseDown(e, target) {
    if (e.button !== 0) return
    if (e.target.closest('.col-resize-handle, input')) return
    if (onBeforePress) onBeforePress()
    e.preventDefault()  // suppress native text-selection of the header label
    col = target
    startX = e.clientX
    startY = e.clientY
    dragging.value = false
    // Show the closed-hand cursor from the instant of press: `pressed` covers the headers (via
    // CSS), the body cursor covers the cells the pointer drags across.
    pressed.value = true
    document.body.style.cursor = 'grabbing'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  onUnmounted(() => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    stopAutoScroll()
  })

  return {
    onHeaderMouseDown: onHeaderMouseDown,
    pressed: pressed,
    dragging: dragging,
    dropIndicator: dropIndicator,
    ghost: ghost,
  }
}
