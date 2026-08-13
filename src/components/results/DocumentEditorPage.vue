<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import CodeEditor from '../base/CodeEditor.vue'
import BaseButton from '../base/BaseButton.vue'
import { docExtensions } from '../../utils/docEditor'
import { mongoStringify } from '../../utils/mongoFormat'
import { parseField } from '../../utils/queryParser'
import { errText } from '../../utils/errors'

// The pop-out document window (Studio-3T-style Cmd/Ctrl+J). Opened by the Rust
// open_document_window command, seeded from the window URL on first load. Three modes:
//   - 'edit' (default): the SINGLE reusable "doc-editor" window, retargeted in place via
//     the 'document-target' event; editable + saveable (replace_document).
//   - 'view': a read-only display window (unlimited independent instances) — no editing,
//     no Save, no retarget.
//   - 'insert': the SINGLE reusable "doc-insert" window; no target document — starts on an
//     empty skeleton, saves via insert_document, and offers "Add & Continue".

// Empty starter document for insert mode (cursor lands on the middle blank line).
const INSERT_SKELETON = '{\n  \n}'

const editorRef = ref(null)   // the CodeEditor component instance
// Site-specific editor extensions; recomputed when the readonly mode flips so the Save
// keymap is added/removed. CodeEditor rebuilds its state when this identity changes.
const docExt = computed(() => docExtensions({ onSave: onSave, readOnly: readonly.value }))

// Current target ({ connId, db, coll, idFilter, label, mode }) and editor state.
const target   = ref(null)
const mode     = ref('edit')                          // 'edit' | 'view' | 'insert'
const readonly = computed(() => mode.value === 'view')
const isInsert = computed(() => mode.value === 'insert')
const title    = ref('Edit Document')
const text     = ref('')
const dirty    = ref(false)
const loading  = ref(false)
const saving   = ref(false)
const jsonErr  = ref(null)
const okMsg    = ref(null)   // transient "valid"/"formatted" confirmation (insert mode)

// Read the initial target from the window URL query (?connId=&db=&coll=&idFilter=&label=).
// Insert mode has no target document, so idFilter is optional there.
function targetFromUrl() {
  const p = new URLSearchParams(location.search)
  const connId = p.get('connId')
  const db = p.get('db')
  const coll = p.get('coll')
  const idFilter = p.get('idFilter')
  const urlMode = p.get('mode') || 'edit'
  if (!connId || !db || !coll) return null
  if (urlMode !== 'insert' && !idFilter) return null
  return {
    connId: connId,
    db: db,
    coll: coll,
    idFilter: idFilter || '',
    label: p.get('label') || '',
    mode: urlMode,
  }
}

// The buffer is driven through CodeEditor's model-value; setting text swaps the doc
// without marking it dirty (only user edits, via onEditorChange, flip the dirty flag).
function setEditorText(value) {
  text.value = value
}

function onEditorChange(value) {
  text.value = value
  dirty.value = true
  okMsg.value = null   // any edit invalidates a prior "valid"/"formatted" confirmation
}

// Validate/Format buttons (insert mode). parseField accepts the mongosh dialect
// (ObjectId("…"), ISODate("…"), …) — the same parser Save uses — so what validates is
// exactly what saves. Format re-renders the canonical EJSON back through mongoStringify to
// keep that sugar and pretty-print it.
function onValidate() {
  jsonErr.value = null
  const parsed = parseField(text.value)
  if (!parsed.ok) { jsonErr.value = parsed.error; okMsg.value = null; return }
  okMsg.value = 'Valid JSON document'
}

function onFormat() {
  jsonErr.value = null
  const parsed = parseField(text.value)
  if (!parsed.ok) { jsonErr.value = parsed.error; okMsg.value = null; return }
  setEditorText(mongoStringify(JSON.parse(parsed.ejson)))
  dirty.value = true
  okMsg.value = 'Formatted'
}

// Fetch the target document and load it into the editor. Reuses find_documents with the
// _id filter (limit 1) and pretty-prints the single match.
async function loadTarget(next) {
  if (!next) {
    jsonErr.value = 'No document was specified to edit.'
    return
  }
  target.value = next
  mode.value = next.mode === 'view' ? 'view' : (next.mode === 'insert' ? 'insert' : 'edit')

  // Insert has no document to fetch: seed the empty skeleton and let the user type. The
  // OS window owns the titlebar, so reflect the mode there rather than drawing our own.
  if (isInsert.value) {
    title.value = 'Insert Document'
    getCurrentWindow().setTitle(title.value).catch(() => {})
    setEditorText(INSERT_SKELETON)
    dirty.value = false
    jsonErr.value = null
    return
  }

  // The real OS window owns the titlebar, so reflect the document there rather than
  // drawing our own (a custom top bar would double up with the native one).
  const verb = readonly.value ? 'View Document' : 'Edit Document'
  title.value = next.label ? `${verb} — ${next.label}` : verb
  getCurrentWindow().setTitle(title.value).catch(() => {})
  loading.value = true
  jsonErr.value = null
  try {
    const { documents: docs } = await invoke('find_documents', {
      id: next.connId,
      database: next.db,
      collection: next.coll,
      filter: next.idFilter,
      projection: '{}',
      sort: '{}',
      skip: 0,
      limit: 1,
    })
    const doc = docs && docs.length ? docs[0] : null
    if (!doc) {
      jsonErr.value = 'The document no longer exists.'
      setEditorText('')
    } else {
      setEditorText(mongoStringify(doc))
    }
    dirty.value = false
  } catch (e) {
    jsonErr.value = errText(e)
  } finally {
    loading.value = false
  }
}

// Retarget guard: if there are unsaved edits, confirm before replacing them.
function confirmDiscardIfDirty() {
  if (!dirty.value) return true
  return window.confirm('This document has unsaved changes. Discard them?')
}

// Save the buffer. `keepOpen` is the insert dialog's "Add & Continue" — insert, then
// reset for the next document instead of closing (ignored in edit mode, where save always
// closes). The Mod-s keymap calls this with no argument, so keepOpen is falsy there.
async function onSave(keepOpen) {
  if (readonly.value || !target.value || saving.value) return
  jsonErr.value = null
  okMsg.value = null
  // Parse the mongosh-style text (ObjectId("…"), ISODate("…"), …) back to canonical
  // Extended JSON — the same dialect the query bar / JSON view use. parseField returns a
  // human-readable error on invalid input.
  const parsed = parseField(text.value)
  if (!parsed.ok) { jsonErr.value = parsed.error; return }
  saving.value = true
  try {
    if (isInsert.value) {
      await invoke('insert_document', {
        id: target.value.connId,
        database: target.value.db,
        collection: target.value.coll,
        document: parsed.ejson,
      })
    } else {
      await invoke('replace_document', {
        id: target.value.connId,
        database: target.value.db,
        collection: target.value.coll,
        idFilter: target.value.idFilter,
        document: parsed.ejson,
      })
    }
    await emit('document-saved', {
      connId: target.value.connId,
      db: target.value.db,
      coll: target.value.coll,
    })
    dirty.value = false
    // "Add & Continue": reset to a fresh skeleton and stay open for the next insert.
    if (isInsert.value && keepOpen === true) {
      setEditorText(INSERT_SKELETON)
      dirty.value = false
      saving.value = false
      if (editorRef.value) editorRef.value.focus()
      return
    }
    // Otherwise saving is the terminal action — close the window. The grid behind it was
    // already refreshed via the document-saved event above.
    await getCurrentWindow().close()
  } catch (e) {
    jsonErr.value = errText(e)
    saving.value = false
  }
}

async function onClose() {
  if (!confirmDiscardIfDirty()) return
  await getCurrentWindow().close()
}

// Escape closes the window (like the Close/Cancel button). We skip an event the
// editor already handled — a plain Escape in CodeMirror collapses a multi-range or
// non-empty selection first (preventDefault), so a second Escape closes.
function onWindowKeydown(event) {
  if (event.key !== 'Escape') return
  if (event.defaultPrevented) return
  onClose()
}

let unlisten = null

onMounted(async () => {
  window.addEventListener('keydown', onWindowKeydown)

  // The single window is retargeted in place: reload when the backend emits a new target.
  unlisten = await listen('document-target', (e) => {
    if (!confirmDiscardIfDirty()) return
    loadTarget(e.payload)
  })

  await loadTarget(targetFromUrl())
  if (editorRef.value) editorRef.value.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  if (unlisten) unlisten()
})
</script>

<template>
  <div class="doc-editor">
    <CodeEditor
      ref="editorRef"
      class="editor-wrap"
      :model-value="text"
      :readonly="readonly"
      :extensions="docExt"
      @update:model-value="onEditorChange"
    />

    <div v-if="jsonErr" class="err">{{ jsonErr }}</div>

    <div class="footer">
      <BaseButton v-if="isInsert" :disabled="saving || loading" @click="onValidate">Validate JSON</BaseButton>
      <BaseButton v-if="isInsert" :disabled="saving || loading" @click="onFormat">Format JSON</BaseButton>
      <span v-if="loading" class="hint">Loading…</span>
      <span v-else-if="readonly" class="hint">Read-only</span>
      <span v-else-if="okMsg" class="hint ok">{{ okMsg }}</span>
      <span v-else-if="dirty" class="hint">Unsaved changes</span>
      <span class="spacer"></span>
      <BaseButton v-if="isInsert" :disabled="saving || loading" @click="onSave(true)">
        Add &amp; Continue
      </BaseButton>
      <BaseButton @click="onClose">{{ isInsert ? 'Cancel' : 'Close' }}</BaseButton>
      <BaseButton v-if="!readonly" variant="primary" :disabled="saving || loading" @click="onSave(false)">
        {{ saving ? 'Saving…' : (isInsert ? 'Add Document' : 'Save') }}
      </BaseButton>
    </div>
  </div>
</template>

<style scoped>
.doc-editor {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-window);
  color: var(--text);
}

.editor-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-input);
}

.err {
  flex: none;
  font-size: 12px;
  color: var(--danger-text);
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

.footer {
  height: 48px;
  flex: none;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 8px;
}

.hint { font-size: 12px; color: var(--text-faint); }
.hint.ok { color: var(--success-text); }
.spacer { flex: 1; }

</style>
