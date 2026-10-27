// Document-editor-specific CodeMirror extensions: editing niceties plus a Save (Mod-s)
// keymap. Shared chrome (theme, highlight, language, line numbers, readonly facet,
// v-model) lives in components/base/CodeEditor.vue + utils/codemirror/theme.js.
import { keymap, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { bracketMatching, indentOnInput } from '@codemirror/language'

// `onSave` runs on Cmd/Ctrl+S. `readOnly` drops the editing keymaps (the CodeEditor's
// readonly facet blocks edits; here it just means no Save binding and plain navigation).
export function docExtensions({ onSave, readOnly = false }) {
  if (readOnly) {
    return [
      drawSelection(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
    ]
  }
  return [
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => { onSave(); return true } },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
  ]
}
