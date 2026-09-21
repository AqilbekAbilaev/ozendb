// Whether a key event landed in something that owns its own keys — a text field or a
// CodeMirror editor — so app-wide shortcuts must stay out of its way.
const EDITING = 'input, textarea, [contenteditable], .cm-editor'

export function isEditingTarget(el) {
  return !!(el && el.closest && el.closest(EDITING))
}
