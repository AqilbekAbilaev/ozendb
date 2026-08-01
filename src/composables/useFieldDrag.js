import { ref, onUnmounted } from 'vue'

// Dragging a result cell into the Visual Query Builder.
//
// HTML5 drag-and-drop doesn't fire drop events reliably inside Tauri's WKWebView, so
// this is done with raw mouse events. A drag only starts once the pointer moves past a
// small threshold, so a plain click still selects the cell. On drop we hit-test the
// pointer against the VQB sections (tagged with data-vqb-drop) and hand the field +
// section up via `vqb-drop`.
//
// The caller keeps ownership of what a mousedown means for editing and selection, and
// calls `beginDrag` once it has decided a drag may start. `suppressNextClick` is exposed
// because the click that fires after a real drag has to be swallowed by the caller's
// click handlers, which own cell selection.
const DRAG_THRESHOLD = 5

export function useFieldDrag({ vqbOpen, emit }) {
  const dragging  = ref(false)
  const dragGhost = ref({ x: 0, y: 0, label: '' })
  const suppressNextClick = ref(false)

  let dragField    = ''
  let dragValue    = ''
  let dragStartX   = 0
  let dragStartY   = 0
  let openedByDrag = false  // did *this* drag auto-open the panel?

  function sectionAtPoint(x, y) {
    const el = document.elementFromPoint(x, y)
    const zone = el && el.closest('[data-vqb-drop]')
    return zone ? zone.getAttribute('data-vqb-drop') : null
  }

  // Start tracking a potential drag from this pointer position. No drag is in flight
  // until the pointer passes DRAG_THRESHOLD, so a click that never moves is unaffected.
  function beginDrag(e, col, value) {
    suppressNextClick.value = false
    openedByDrag = false
    dragField  = col
    dragValue  = value == null ? '' : String(value)
    dragStartX = e.clientX
    dragStartY = e.clientY
    dragging.value = false
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup',   onDragUp)
  }

  function onDragMove(e) {
    if (!dragging.value) {
      if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) < DRAG_THRESHOLD) return
      dragging.value = true
      document.body.style.cursor = 'grabbing'
      // Opening the panel mid-drag renders its drop zones (data-vqb-drop) just in
      // time for the pointer to reach them, so the drop hit-test below still works.
      if (!vqbOpen()) { openedByDrag = true; emit('open-vqb') }
    }
    dragGhost.value = { x: e.clientX, y: e.clientY, label: dragField }
    emit('drag-over-section', sectionAtPoint(e.clientX, e.clientY))
  }

  function onDragUp(e) {
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup',   onDragUp)
    document.body.style.cursor = ''
    if (dragging.value) {
      const section = sectionAtPoint(e.clientX, e.clientY)
      if (section) emit('vqb-drop', { field: dragField, value: dragValue, section: section, nonce: Date.now() })
      // Dropped outside the panel: if this drag is what opened it, close it again.
      else if (openedByDrag) emit('close-vqb')
      suppressNextClick.value = true  // swallow the click that fires after a real drag
    }
    dragging.value = false
    emit('drag-over-section', null)
    dragField = ''
    dragValue = ''
  }

  onUnmounted(() => {
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup',   onDragUp)
  })

  return { dragging, dragGhost, suppressNextClick, beginDrag }
}
