import { updateSettings } from '../appApi/settings'
import { showToast } from '../stores/toast'
import { applyZoom, zoom } from '../stores/settings'
import { DEFAULT_ZOOM, stepZoom } from '../utils/zoom'

// UI zoom for the main window.
//
// Uses the webview's own zoom rather than a CSS transform: the app measures real DOM
// geometry in several places (tab widths in TabBar, the resizable split panes, the
// pipeline box), and a scaled coordinate space would put those measurements out of step
// with what the user sees. Webview zoom scales layout itself, so the measurements stay true.
//
// The ladder and clamping live in utils/zoom.js; the value and its application live in
// stores/settings.js alongside the other persisted preferences. This is only the stepping.
export function useZoom() {
  async function apply(factor) {
    await applyZoom(factor)
    try { await updateSettings({ uiZoom: factor }) } catch (_) {}
  }

  function announce(factor) {
    showToast(`Zoom ${Math.round(factor * 100)}%`)
  }

  async function zoomBy(delta) {
    const next = stepZoom(zoom.value, delta)
    if (next === zoom.value) {
      // Already at an end of the ladder — say so rather than silently doing nothing.
      announce(next)
      return
    }
    await apply(next)
    announce(next)
  }

  const zoomIn = () => zoomBy(1)
  const zoomOut = () => zoomBy(-1)
  async function resetZoom() {
    await apply(DEFAULT_ZOOM)
    announce(DEFAULT_ZOOM)
  }

  return { zoomIn: zoomIn, zoomOut: zoomOut, resetZoom: resetZoom }
}
