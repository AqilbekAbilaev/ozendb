import { ref } from 'vue'
import { getKeybindings, getSettings, updateKeybindings, updateSettings } from '../appApi/settings'
import { mergeBindings } from '../utils/keybindings'
import { normalizedTheme, writeThemeMirror } from '../utils/themeMirror'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { DEFAULT_ZOOM, nearestZoom } from '../utils/zoom'

const DEFAULTS = {
  defaultQueryLimit: 50,
  theme: 'dark',
  defaultResultView: 'table',
  restoreSessionEnabled: true,
  editorTabWidth: 4,
}

export const defaultQueryLimit = ref(DEFAULTS.defaultQueryLimit)
export const theme = ref(DEFAULTS.theme)
export const defaultResultView = ref(DEFAULTS.defaultResultView)
export const restoreSessionEnabled = ref(DEFAULTS.restoreSessionEnabled)
export const editorTabWidth = ref(DEFAULTS.editorTabWidth)
export const keyBindings = ref(mergeBindings(null))
export const zoom = ref(DEFAULT_ZOOM)

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function adoptTheme(value) {
  theme.value = writeThemeMirror(value)
}

function adoptSettings(settings) {
  defaultQueryLimit.value = positiveNumber(settings?.default_query_limit, DEFAULTS.defaultQueryLimit)
  adoptTheme(settings?.theme)
  defaultResultView.value = ['table', 'json', 'tree'].includes(settings?.default_result_view)
    ? settings.default_result_view
    : DEFAULTS.defaultResultView
  restoreSessionEnabled.value = typeof settings?.restore_session === 'boolean'
    ? settings.restore_session
    : DEFAULTS.restoreSessionEnabled
  editorTabWidth.value = positiveNumber(settings?.editor_tab_width, DEFAULTS.editorTabWidth)
}

// Snapped through the ladder so a hand-edited settings.json can't leave the UI at an
// unusable size, and applied even at 100% since a webview can retain a zoom across reloads.
export async function applyZoom(factor) {
  zoom.value = nearestZoom(factor)
  try {
    await getCurrentWebview().setZoom(zoom.value)
  } catch (_) {
    // A webview that refuses the zoom must not take startup down; the stored value
    // still applies on the next launch.
  }
}

export async function loadSettings() {
  const settings = await getSettings()
  adoptSettings(settings)
  try {
    keyBindings.value = mergeBindings(await getKeybindings())
  } catch (_) {}
  await applyZoom(settings?.ui_zoom)
  return settings
}

export async function savePreferences(preferences) {
  const settings = await updateSettings(preferences)
  adoptSettings(settings)
}

export async function saveKeybindings(bindings) {
  keyBindings.value = mergeBindings(await updateKeybindings(bindings))
}

export async function setTheme(next) {
  const settings = await updateSettings({
    defaultQueryLimit: defaultQueryLimit.value,
    theme: normalizedTheme(next),
  })
  adoptSettings(settings)
}

// Module-scope state persists through HMR. Tests use this explicit reset to avoid
// inheriting values from another case; runtime callers should load persisted settings.
export function resetSettings() {
  defaultQueryLimit.value = DEFAULTS.defaultQueryLimit
  adoptTheme(DEFAULTS.theme)
  zoom.value = DEFAULT_ZOOM
  defaultResultView.value = DEFAULTS.defaultResultView
  restoreSessionEnabled.value = DEFAULTS.restoreSessionEnabled
  editorTabWidth.value = DEFAULTS.editorTabWidth
  keyBindings.value = mergeBindings(null)
}
