import { ref } from 'vue'
import { getKeybindings, getSettings, updateKeybindings, updateSettings } from '../appApi/settings'
import { mergeBindings } from '../utils/keybindings'
import { normalizedTheme, writeThemeMirror } from '../utils/themeMirror'

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

export async function loadSettings() {
  const settings = await getSettings()
  adoptSettings(settings)
  try {
    keyBindings.value = mergeBindings(await getKeybindings())
  } catch (_) {}
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
  defaultResultView.value = DEFAULTS.defaultResultView
  restoreSessionEnabled.value = DEFAULTS.restoreSessionEnabled
  editorTabWidth.value = DEFAULTS.editorTabWidth
  keyBindings.value = mergeBindings(null)
}
