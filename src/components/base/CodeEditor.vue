<script setup>
import { ref, shallowRef, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import { EditorView, lineNumbers as lineNumbersExt, keymap } from '@codemirror/view'
import { EditorState, Prec } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { syntaxHighlighting, indentUnit, bracketMatching } from '@codemirror/language'
import { baseTheme, codeHighlightStyle, jsonHighlightStyle } from '../../utils/codemirror/theme'
import { languageExtension } from '../../utils/codemirror/languages'

// Reusable CodeMirror 6 editor/viewer. Owns the EditorView lifecycle and v-model sync;
// everything site-specific (Mongo autocomplete, run/save keymaps, code folding, doc
// dividers) is supplied through the `extensions` prop. Shared chrome (theme, highlight,
// language, line numbers) lives here, so IntelliShell, the document editor and the JSON
// view no longer each hand-roll their own EditorView.
const props = defineProps({
  modelValue: { type: String, default: '' },
  readonly: { type: Boolean, default: false },
  highlight: { type: String, default: 'code' }, // 'code' | 'json'
  // Grammar for tokenizing: 'js' (default, also Node/Mongo shell), 'python', 'java',
  // 'csharp', 'php', 'ruby', 'go'. See utils/codemirror/languages.js.
  language: { type: String, default: 'js' },
  lineNumbers: { type: Boolean, default: true },
  // Extra CodeMirror extensions. Pass a stable array (e.g. a computed) — a new identity
  // rebuilds the editor state.
  extensions: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])

// Spaces per indent level (Preferences → Appearance). Injected so every editor —
// IntelliShell, the document editor, the JSON view — honors the one setting.
const editorTabWidth = inject('editorTabWidth', ref(4))

const hostEl = ref(null)
const view = shallowRef(null)
// True while we push an external modelValue into the view, so the resulting docChanged
// doesn't echo straight back out as an update:modelValue.
let applyingModelValue = false

function buildState() {
  const base = []
  if (props.lineNumbers) base.push(lineNumbersExt())
  const tabWidth = editorTabWidth.value
  base.push(EditorState.tabSize.of(tabWidth))
  base.push(indentUnit.of(' '.repeat(tabWidth)))
  // Basic editing keys (Enter → newline+indent, Home/End, word motions…). Without these
  // the browser's own contenteditable handling takes over Enter and inserts two lines.
  // Undo/redo needs the history state field, not just the keymap. The shell and document
  // editors add their own history() — CodeMirror dedupes the shared state field, so the
  // two copies are one. Lowest precedence so a site's own bindings (shell's Mod-Enter,
  // docEditor's Mod-s) still win.
  base.push(closeBrackets())
  base.push(bracketMatching())
  base.push(history())
  base.push(Prec.low(keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap])))
  base.push(languageExtension(props.language))
  base.push(syntaxHighlighting(props.highlight === 'json' ? jsonHighlightStyle : codeHighlightStyle))
  base.push(baseTheme)
  // readonly blocks edits but keeps the editor focusable (caret + keyboard select). A
  // fully non-interactive viewer (the JSON results view) adds EditorView.editable.of(false)
  // through its own extensions.
  if (props.readonly) base.push(EditorState.readOnly.of(true))
  base.push(EditorView.updateListener.of((update) => {
    if (update.docChanged && !applyingModelValue) emit('update:modelValue', update.state.doc.toString())
  }))
  return EditorState.create({ doc: props.modelValue ?? '', extensions: [...base, ...props.extensions] })
}

onMounted(() => {
  view.value = new EditorView({ state: buildState(), parent: hostEl.value })
})
onBeforeUnmount(() => {
  if (view.value) { view.value.destroy(); view.value = null }
})

// External value change (load a document, switch shell tab) → swap the doc without echo.
watch(() => props.modelValue, (val) => {
  const v = view.value
  if (!v) return
  if ((val ?? '') === v.state.doc.toString()) return
  applyingModelValue = true
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: val ?? '' } })
  applyingModelValue = false
})

// Config changes rebuild the whole state — these are infrequent (readonly/mode/target or
// a new extensions array), unlike per-keystroke doc changes handled above.
watch([() => props.readonly, () => props.highlight, () => props.language, () => props.lineNumbers, () => props.extensions], () => {
  if (view.value) view.value.setState(buildState())
})

function focus() { if (view.value) view.value.focus() }
// getView exposes the live EditorView for the few sites that read the cursor line or the
// freshest buffer text (IntelliShell's run-line / save-script).
defineExpose({ focus, getView: () => view.value })
</script>

<template>
  <div ref="hostEl" class="code-editor"></div>
</template>

<style scoped>
.code-editor { height: 100%; min-height: 0; overflow: hidden; }
</style>
