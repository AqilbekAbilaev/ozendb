import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { ZOOM_LEVELS, DEFAULT_ZOOM, nearestZoom, stepZoom } from '../utils/zoom'

// UI zoom for the main window.
//
// Uses the webview's own zoom rather than a CSS transform: the app measures real DOM
// geometry in several places (tab widths in TabBar, the resizable split panes, the
// pipeline box), and a scaled coordinate space would put those measurements out of step
// with what the user sees. Webview zoom scales layout itself, so the measurements stay true.
//
// The ladder and clamping live in utils/zoom.js so they stay unit tested; this only
// applies the result and persists it.
export function useZoom({ showToast }) {
  const zoom = ref(DEFAULT_ZOOM)

  async function apply(factor, { persist = true } = {}) {
    zoom.value = factor
    try {
      await getCurrentWebview().setZoom(factor)
    } catch (_) {
      // A webview that refuses the zoom shouldn't take the action down with it; the
      // stored value still applies on the next launch.
    }
    if (persist) {
      try { await invoke('update_settings', { uiZoom: factor }) } catch (_) {}
    }
  }

  // Restore the persisted level at startup. Snapped through the ladder so a hand-edited
  // settings.json can't leave the UI at an unusable size. Applied even at 100%, since a
  // webview can retain a zoom across reloads. Not persisted — nothing changed yet.
  async function loadZoom(saved) {
    await apply(nearestZoom(saved), { persist: false })
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

  return {
    zoom: zoom,
    zoomIn: zoomIn,
    zoomOut: zoomOut,
    resetZoom: resetZoom,
    loadZoom: loadZoom,
    ZOOM_LEVELS: ZOOM_LEVELS,
  }
}
