<script setup>
import { ref, computed, watch, inject } from 'vue'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { stageImportText } from '../../appApi/files'
import { importPreview, importCollectionMapped } from '../../engines/mongodb/api/transfer'
import { errText, errCode } from '../../utils/errors'
import { useImportPaneLifecycle } from '../../composables/useImportPaneLifecycle'
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import { cellText } from '../../utils/format'
import { INSERT_MODES, PREVIEW_LIMIT } from '../../constants/dataTools'

// Import surface for a collection, rendered as a workspace tab (kind 'import').
// The format was chosen in the ImportFormatModal picker and lives on the tab.
// Modelled on Studio 3T's import tab: a task toolbar, a target-connection bar, an
// optional validate toggle, a multi-source table (each file → target db/collection
// with an insertion mode), and a collapsible output preview. Run loops over the
// sources on the frontend, one import_collection_mapped call per source.
const props = defineProps({
  activeTab: { type: Object, required: true },
})

const bundle = inject('appModals')
const showToast = bundle.handlers.showToast
const onImported = bundle.handlers.onWizardImported   // refresh the connection tree

// "Change target" opens the Connection Manager (the app's single place to pick /
// edit connections).
function changeTarget() {
  bundle.modals.openModal('connectionManager')
}

// Insertion modes. Only plain insert is wired today; overwrite/merge/skip need a
// backend `mode` param on import_collection_mapped (a follow-up).


const t = computed(() => props.activeTab)
const fmt = computed(() => (t.value.format || 'json').toUpperCase())
const isJson = computed(() => t.value.format === 'json')
const lifecycle = useImportPaneLifecycle()

const running = computed(() => !!t.value._importRunning)
const error = computed(() => t.value._importError || null)
const errorCode = computed(() => t.value._importErrorCode || null)
const done = computed(() => t.value._importDone || null)

// Output preview (for the selected source).
const previewLoading = ref(false)
const previewError = ref(null)
const previewCols = ref([])
const previewRows = ref([])

watch(() => props.activeTab, (tab) => {
  lifecycle.attach(tab)
  previewLoading.value = false
  previewError.value = null
  previewCols.value = []
  previewRows.value = []
}, { immediate: true })

function setError(e, tab = t.value) {
  tab._importError = errText(e)
  tab._importErrorCode = errCode(e)
}

function baseName(p) {
  return String(p).split(/[\\/]/).pop() || String(p)
}

// ── sources ────────────────────────────────────────────────────
async function addSource() {
  const request = lifecycle.beginSource(t.value)
  request.tab._importError = null
  request.tab._importErrorCode = null
  let picked
  try {
    picked = await openDialog({
      multiple: true,
      filters: [{ name: request.format.toUpperCase(), extensions: [request.format] }],
    })
  } catch (e) {
    setError(e, request.tab)
    return
  }
  if (!picked) return
  const paths = Array.isArray(picked) ? picked : [picked]
  for (const p of paths) {
    request.tab.sources.push({
      path: String(p),
      name: baseName(p),
      targetDb: request.targetDb,
      targetColl: request.targetColl,
      mode: 'insert',
    })
  }
  request.tab.selectedSource = request.tab.sources.length - 1
}

function removeSource() {
  const i = t.value.selectedSource
  if (i < 0 || i >= t.value.sources.length) return
  t.value.sources.splice(i, 1)
  t.value.selectedSource = Math.min(i, t.value.sources.length - 1)
}

function selectSource(i) {
  if (t.value.selectedSource === i) {
    if (t.value.previewOpen) loadPreview()
    return
  }
  t.value.selectedSource = i
}

// Paste from clipboard: the text is staged as a temp file so it flows through the same
// path-based preview/import as a picked file.
async function pasteSource() {
  const request = lifecycle.beginSource(t.value)
  request.tab._importError = null
  request.tab._importErrorCode = null
  let text = ''
  try {
    text = await navigator.clipboard.readText()
  } catch (e) {
    setError(e, request.tab)
    return
  }
  if (!text || !text.trim()) {
    showToast('Clipboard is empty')
    return
  }
  await stageText(text, request)
}

async function stageText(text, request) {
  let path
  try {
    path = await stageImportText(text, request.format)
  } catch (e) {
    setError(e, request.tab)
    return
  }
  request.tab.sources.push({
    path: path,
    name: `Clipboard.${request.format}`,
    targetDb: request.targetDb,
    targetColl: request.targetColl,
    mode: 'insert',
  })
  request.tab.selectedSource = request.tab.sources.length - 1
}

// ── output preview ─────────────────────────────────────────────
function togglePreview() {
  t.value.previewOpen = !t.value.previewOpen
}

async function loadPreview() {
  const src = t.value.sources[t.value.selectedSource]
  previewError.value = null
  previewCols.value = []
  previewRows.value = []
  if (!src) {
    lifecycle.cancelPreview()
    previewLoading.value = false
    return
  }
  const request = lifecycle.beginPreview(t.value, src)
  previewLoading.value = true
  try {
    const preview = await importPreview(request.path, request.format, PREVIEW_LIMIT)
    if (!lifecycle.isCurrentPreview(request, props.activeTab)) return
    previewCols.value = preview.columns || []
    previewRows.value = preview.rows || []
  } catch (e) {
    if (!lifecycle.isCurrentPreview(request, props.activeTab)) return
    previewError.value = errText(e)
  } finally {
    if (lifecycle.isCurrentPreview(request, props.activeTab)) previewLoading.value = false
  }
}

// ── run ────────────────────────────────────────────────────────
const canRun = computed(() =>
  t.value.sources.length > 0 &&
  t.value.sources.every(s => String(s.targetDb).trim() && String(s.targetColl).trim())
)

async function run() {
  if (!canRun.value || running.value) return
  const runTab = t.value
  const request = lifecycle.beginRun(runTab)
  runTab._importRunning = true
  runTab._importError = null
  runTab._importErrorCode = null
  runTab._importDone = null
  try {
    // Optional early validation: confirm each file parses before writing anything.
    if (request.format === 'json' && request.validate) {
      for (const s of request.sources) {
        await importPreview(s.path, request.format, 1)
      }
    }
    let total = 0
    for (const s of request.sources) {
      const count = await importCollectionMapped(
        { connectionId: request.connectionId, database: String(s.targetDb).trim(), collection: String(s.targetColl).trim() },
        s.path,
        request.format,
        [],
      )
      total += count
    }
    showToast(`Imported ${total} document${total === 1 ? '' : 's'} from ${request.sources.length} source${request.sources.length === 1 ? '' : 's'}`)
    onImported(request.connectionId)
    runTab._importDone = { count: total }
  } catch (e) {
    setError(e, runTab)
    if (!lifecycle.isCurrentRun(request, props.activeTab)) showToast(`Import failed: ${errText(e)}`)
  } finally {
    runTab._importRunning = false
  }
}

function reset() {
  t.value._importDone = null
  t.value._importError = null
  t.value._importErrorCode = null
}

// Include the path because removing a source can leave the selected index unchanged.
watch(() => {
  const source = t.value.sources[t.value.selectedSource]
  return [t.value.id, t.value.previewOpen, t.value.selectedSource, source?.path]
}, () => { if (t.value.previewOpen) loadPreview() })
</script>

<template>
  <div class="imp">
    <!-- toolbar -->
    <div class="imp-toolbar">
      <BaseButton variant="ghost" size="sm" class="run" :disabled="!canRun || running" @click="run">
        <BaseIcon name="run" :size="18" class="ic" /> {{ running ? 'Running…' : 'Run' }}
      </BaseButton>
    </div>

    <!-- done state -->
    <div v-if="done" class="imp-done">
      <StateMessage
        mode="empty"
        :label="`Imported ${done.count} document${done.count === 1 ? '' : 's'}`"
      />
      <BaseButton variant="ghost" size="sm" bordered @click="reset">Import more</BaseButton>
    </div>

    <template v-else>
      <div class="imp-scroll">
        <!-- target connection -->
        <section class="imp-sec">
          <h3 class="imp-h">Target connection</h3>
          <div class="target-bar">
            <button type="button" class="target-chip" @click="changeTarget">
              <BaseIcon name="connect" :size="15" />
              {{ t.connName }}
            </button>
            <button type="button" class="target-change" @click="changeTarget">
              <BaseIcon name="refresh" :size="13" /> Change target
            </button>
          </div>
        </section>

        <!-- validate (JSON only) -->
        <label v-if="isJson" class="validate-row">
          <BaseCheckbox v-model="t.validate" />
          Validate JSON before import
          <BaseIcon name="info" :size="14" class="info-ic"
            title="Checks each file parses before any documents are written." />
        </label>

        <!-- sources -->
        <section class="imp-sec">
          <h3 class="imp-h">Select {{ fmt }} sources to import:</h3>
          <div class="src-actions">
            <BaseButton variant="ghost" size="sm" @click="addSource">
              <BaseIcon name="plus" :size="18" class="ic" /> Add source
            </BaseButton>
            <BaseButton variant="ghost" size="sm" :disabled="t.selectedSource < 0" @click="removeSource">
              <BaseIcon name="trash" :size="18" class="ic" /> Remove source
            </BaseButton>
            <span class="tb-div"></span>
            <BaseButton variant="ghost" size="sm" @click="pasteSource">
              <BaseIcon name="paste" :size="18" class="ic" /> Paste from clipboard
            </BaseButton>
          </div>

          <div class="src-table-wrap">
            <table class="src-table">
              <thead>
                <tr>
                  <th>{{ fmt }} Source</th>
                  <th>Target Database</th>
                  <th>Target Collection</th>
                  <th>Insertion mode</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(s, i) in t.sources"
                  :key="i"
                  class="src-row"
                  :class="{ selected: i === t.selectedSource }"
                  @click="selectSource(i)"
                >
                  <td class="src-name" :title="s.path">{{ s.name }}</td>
                  <td><BaseInput v-model="s.targetDb" class="src-input" /></td>
                  <td><BaseInput v-model="s.targetColl" class="src-input" /></td>
                  <td><BaseSelect v-model="s.mode" class="src-select" :options="INSERT_MODES" size="sm" /></td>
                </tr>
                <tr v-if="!t.sources.length" class="src-empty">
                  <td colspan="4">No sources yet — click “Add source” to choose {{ fmt }} file(s).</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <StateMessage v-if="error" mode="error" :message="error" :code="errorCode" />
      </div>

      <!-- output preview -->
      <div class="imp-preview" :class="{ open: t.previewOpen }">
        <button class="preview-bar" @click="togglePreview">
          <span>Output preview</span>
          <BaseIcon name="caretDown" :size="14" class="preview-caret" :class="{ up: !t.previewOpen }" />
        </button>
        <div v-if="t.previewOpen" class="preview-body">
          <StateMessage v-if="previewLoading" mode="loading" label="Loading preview…" />
          <StateMessage v-else-if="previewError" mode="error" :message="previewError" />
          <StateMessage v-else-if="t.selectedSource < 0" mode="empty" label="Select a source to preview" />
          <table v-else-if="previewCols.length" class="preview-table">
            <thead>
              <tr><th v-for="c in previewCols" :key="c">{{ c }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in previewRows" :key="ri">
                <td v-for="c in previewCols" :key="c" :title="cellText(row[c])">{{ cellText(row[c]) }}</td>
              </tr>
            </tbody>
          </table>
          <StateMessage v-else mode="empty" label="Nothing to preview" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.imp { display: flex; flex-direction: column; height: 100%; min-height: 0; }

/* task toolbar */
.imp-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-soft);
  flex: none;
}
/* Match the Collection tab's toolbar buttons: ghost BaseButton + dimmed icon, with
   the Run button carrying the same green outline. */
.ic { color: var(--text-dim); }
.base-btn.run { min-width: 92px; justify-content: flex-start; border: 1px solid var(--green); }
.run .ic { color: var(--green); }
.tb-div { width: 1px; align-self: stretch; margin: 4px 4px; background: var(--border-soft); }

/* scroll body */
.imp-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.imp-sec { display: flex; flex-direction: column; gap: 8px; }
.imp-h { font-size: 13px; font-weight: 600; color: var(--text); margin: 0; }

/* target connection */
.target-bar { display: flex; align-items: center; gap: 10px; }
.target-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--text);
  background: none;
  cursor: pointer;
}
.target-chip:hover { border-color: var(--accent); }
.target-chip .base-icon { color: var(--text-faint); }
.target-change {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--accent);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.target-change:hover { text-decoration: underline; }

/* validate */
.validate-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-dim);
  cursor: pointer;
}
.info-ic { color: var(--text-faint); }

/* source actions */
.src-actions { display: flex; align-items: center; gap: 4px; }

/* source table */
.src-table-wrap { border: 1px solid var(--border-soft); border-radius: 6px; overflow: hidden; }
.src-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.src-table th {
  text-align: left;
  padding: 7px 10px;
  background: var(--bg-input);
  color: var(--text-dim);
  font-weight: 500;
  border-bottom: 1px solid var(--border-soft);
}
.src-row { cursor: pointer; border-bottom: 1px solid var(--grid-line); }
.src-row:hover { background: var(--bg-hover); }
.src-row.selected { background: var(--accent); }
.src-row.selected td { color: #fff; }
.src-row td { padding: 4px 10px; vertical-align: middle; }
.src-name {
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}
.src-row.selected .src-name { color: #fff; }
.base-input.src-input { border-radius: 5px; padding: 3px 6px; font-size: 12px; }
.src-select { min-width: 200px; }
.src-empty td { padding: 16px 10px; text-align: center; color: var(--text-faint); }

/* output preview */
.imp-preview { flex: none; border-top: 1px solid var(--border-soft); display: flex; flex-direction: column; }
.imp-preview.open { max-height: 40%; }
.preview-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  position: relative;
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-input);
  border: none;
  color: var(--text-dim);
  font-size: 12.5px;
  cursor: pointer;
}
.preview-bar:hover { color: var(--text); }
.preview-caret { position: absolute; right: 14px; transition: transform .12s ease; }
.preview-caret.up { transform: rotate(180deg); }
.preview-body { overflow: auto; padding: 8px; min-height: 80px; }
.preview-table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
.preview-table th, .preview-table td {
  border-bottom: 1px solid var(--grid-line);
  border-right: 1px solid var(--grid-line);
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview-table th { background: var(--bg-input); color: var(--text-dim); font-weight: 500; position: sticky; top: 0; }
.preview-table td { color: var(--text); font-family: var(--mono); }

/* done */
.imp-done {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
</style>
