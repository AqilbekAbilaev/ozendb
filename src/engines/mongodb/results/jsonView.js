// JSON-view-specific CodeMirror extensions: native code folding and a divider drawn
// between top-level documents. Shared chrome (theme, JSON highlight via highlight="json",
// language, line numbers, readonly, v-model) lives in components/base/CodeEditor.vue +
// utils/codemirror/theme.js. CodeMirror virtualizes rendering and folds objects/arrays via
// the JS syntax tree, which is why the JSON view uses it rather than a hand-rolled row list.
import { EditorView, Decoration } from '@codemirror/view'
import { EditorState, StateField, RangeSetBuilder } from '@codemirror/state'
import { foldGutter, codeFolding } from '@codemirror/language'

// Divider between documents. Each result document is a top-level object, so its first
// line is exactly "{" (nested and array-element braces are indented). Draw a divider
// above every document except the first. Marking the start line — rather than the
// closing brace — keeps the divider visible even when the preceding document is folded
// down to a single line.
const docDivider = Decoration.line({ class: 'cm-doc-divider' })

function buildDividers(state) {
  const builder = new RangeSetBuilder()
  let seenFirst = false
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)
    if (line.text !== '{') continue
    if (seenFirst) builder.add(line.from, line.from, docDivider)
    else seenFirst = true
  }
  return builder.finish()
}

const docDividerField = StateField.define({
  create: buildDividers,
  update(value, tr) {
    if (tr.docChanged) return buildDividers(tr.state)
    return value
  },
  provide: (field) => EditorView.decorations.from(field),
})

// JSON-view chrome layered over the base theme: tighter type, a transparent (borderless)
// gutter, fold-gutter styling and the inter-document divider rule.
const jsonTheme = EditorView.theme({
  '.cm-scroller': { fontSize: '12.5px', lineHeight: '1.5' },
  '.cm-content': { padding: '10px 0' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 14px', minWidth: '34px' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', cursor: 'pointer', color: 'var(--text-faint)' },
  '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-faint)', padding: '0 4px' },
  '.cm-doc-divider': { borderTop: '1px solid var(--border-soft)' },
})

/** Extensions for the read-only results JSON view (use with CodeEditor readonly highlight="json"). */
export function jsonViewerExtensions() {
  return [
    // Read-only but still focusable — allows Ctrl+F search and text selection.
    EditorState.readOnly.of(true),
    codeFolding(),
    foldGutter(),
    docDividerField,
    jsonTheme,
  ]
}
