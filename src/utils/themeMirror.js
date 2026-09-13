// Both webviews paint before Vue mounts and before settings load from the backend, so
// the chosen theme is mirrored into localStorage for them to read on the way up —
// without it a light-theme user gets a dark flash on every launch. settings.js owns the
// authoritative value and writes the mirror; the entry points only read it.
//
// The key keeps its legacy `s4t-` prefix from the app's previous name. Renaming it would
// silently reset every existing user's mirror, and the only symptom would be that flash.
export const THEME_KEY = 's4t-theme'

export function normalizedTheme(value) {
  return value === 'light' ? 'light' : 'dark'
}

function paint(theme) {
  document.documentElement.dataset.theme = theme
  return theme
}

// localStorage is always defined in a webview, but reading it throws outright where the
// platform blocks site data. Pre-painting runs before Vue mounts, so an uncaught throw
// here is a blank window rather than a wrong colour — hence catch, not a typeof check.
function readMirror() {
  try { return localStorage.getItem(THEME_KEY) } catch (_) { return null }
}

// Read-only on purpose: pre-painting must not write the mirror back, or a fresh install
// would persist a theme the user never chose.
export function prePaintTheme() {
  return paint(normalizedTheme(readMirror()))
}

export function writeThemeMirror(value) {
  const next = paint(normalizedTheme(value))
  try { localStorage.setItem(THEME_KEY, next) } catch (_) {}
  return next
}
