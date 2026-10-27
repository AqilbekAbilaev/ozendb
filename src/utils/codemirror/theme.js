// Shared CodeMirror 6 theme + highlight styles for every editor/viewer in the app
// (IntelliShell, the document editor, the results JSON view). Previously each of
// engines/mongodb/query/shellEditor.js, utils/docEditor.js and utils/jsonView.js defined its own
// byte-for-byte copy of these; they now import from here so the palette is defined once.
import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// Base editor chrome: mono font, transparent background, themed gutter/selection, and the
// autocomplete tooltip styling. Site-specific tweaks (line height, gutter colour, font
// size) are layered on top by passing an extra EditorView.theme in the `extensions` prop.
export const baseTheme = EditorView.theme(
  {
    '&': { height: '100%', color: 'var(--text)', backgroundColor: 'transparent', fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7', overflow: 'auto' },
    '.cm-content': { padding: '12px 0', caretColor: 'var(--text)' },
    // The app's global reset (theme.css) sets `user-select: none` on every element, which
    // would make read-only content unselectable. Re-enable it on the code content and its
    // token spans; the gutter is left alone so copies omit the line numbers.
    '.cm-content, .cm-content *': { userSelect: 'text', WebkitUserSelect: 'text' },
    '.cm-gutters': { backgroundColor: 'var(--bg-panel-2)', color: 'var(--text-faint)', border: 'none', borderRight: '1px solid var(--border)' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 16px' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-dim)' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--text)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'rgba(59,130,246,0.30)' },
    '.cm-tooltip': { backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-soft)', borderRadius: '6px' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--bg-hover)', color: 'var(--text)' },
  },
  { dark: true },
)

// Default highlight: JS/EJSON read as JS object literals, so lang-javascript colours them
// well. Mapped to the app's cell/JSON token palette. Used by the shell and document editor.
export const codeHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--cell-op)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--cell-str)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--cell-num)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--cell-key)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--link)' },
  { tag: [t.comment], color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation], color: 'var(--text-dim)' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--text)' },
])

// JSON-view variant: null is faint (not number-coloured), no keyword rule, and
// ObjectId()/ISODate() render as function calls in the link colour.
export const jsonHighlightStyle = HighlightStyle.define([
  { tag: [t.propertyName, t.attributeName], color: 'var(--cell-key)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--cell-str)' },
  { tag: [t.number, t.bool], color: 'var(--cell-num)' },
  { tag: t.null, color: 'var(--text-faint)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--link)' },
  { tag: [t.punctuation, t.separator, t.operator], color: 'var(--text-dim)' },
])
