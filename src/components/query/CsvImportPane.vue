<script setup>
import { ref, computed, watch, inject } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { errText, errCode } from '../../utils/errors'
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import BaseRadio from '../base/BaseRadio.vue'
import NumberStepper from '../base/NumberStepper.vue'
import StateMessage from '../base/StateMessage.vue'
import HintText from '../base/HintText.vue'
import { cellText } from '../../utils/format'
import { INSERT_MODES, BSON_KINDS, PREVIEW_LIMIT } from '../../constants/dataTools'

// CSV import tab, modelled on Studio 3T's CSV import: a Source options / Target
// options split, a single source (Clipboard or File), a CSV options panel
// (delimiter / qualifier / skip lines / header), a live preview that reflects those
// options, and a column→field mapping on the Target side. All state lives on the tab
// (props.activeTab) so it survives tab switches and is persisted.
const props = defineProps({
  activeTab: { type: Object, required: true },
})

const bundle = inject('appModals')
const showToast = bundle.handlers.showToast
const onImported = bundle.handlers.onWizardImported

const SUB_TABS = [
  { value: 'source', label: 'Source options' },
  { value: 'target', label: 'Target options' },
]
const DELIMITERS = [
  { value: ',', label: 'Comma (,)' },
  { value: '\t', label: 'Tab' },
  { value: ';', label: 'Semicolon (;)' },
  { value: '|', label: 'Pipe (|)' },
  { value: ' ', label: 'Space' },
  { value: 'other', label: 'Other' },
]

const t = computed(() => props.activeTab)

const running = ref(false)
const error = ref(null)
const errorCode = ref(null)
const done = ref(null)

const previewLoading = ref(false)
const previewError = ref(null)
const previewCols = ref([])
const previewRows = ref([])

function setError(e) {
  error.value = errText(e)
  errorCode.value = errCode(e)
}
function baseName(p) {
  return String(p).split(/[\\/]/).pop() || String(p)
}

const sourceName = computed(() => (t.value.filePath ? baseName(t.value.filePath) : ''))

// The delimiter actually sent to the backend: the dropdown value, or the custom
// "Other" character when that's chosen.
const effectiveDelimiter = computed(() => {
  const d = t.value.csv.delimiter
  return d === 'other' ? (t.value.csv.other || ',') : d
})

function csvPayload() {
  return {
    delimiter: effectiveDelimiter.value,
    quote: t.value.csv.qualifier || '"',
    hasHeaders: t.value.csv.hasHeader,
    skipLines: Number(t.value.csv.skipLines) || 0,
  }
}

// ── source ─────────────────────────────────────────────────────
async function selectFile() {
  error.value = null
  let picked
  try {
    picked = await openDialog({ multiple: false, filters: [{ name: 'CSV', extensions: ['csv'] }] })
  } catch (e) {
    setError(e)
    return
  }
  if (!picked) return
  t.value.filePath = String(picked)
  loadPreview()
}

async function pasteFromClipboard() {
  error.value = null
  let text = ''
  try {
    text = await invoke('read_clipboard_text')
  } catch (e) {
    setError(errText(e))
    return
  }
  if (!text || !text.trim()) {
    showToast('Clipboard is empty')
    return
  }
  try {
    t.value.filePath = await invoke('stage_import_text', { content: text, format: 'csv' })
  } catch (e) {
    setError(e)
    return
  }
  loadPreview()
}

// ── preview + column detection ─────────────────────────────────
async function loadPreview() {
  previewError.value = null
  previewCols.value = []
  previewRows.value = []
  if (!t.value.filePath) return
  previewLoading.value = true
  try {
    const preview = await invoke('import_preview', {
      path: t.value.filePath,
      format: 'csv',
      limit: PREVIEW_LIMIT,
      csv: csvPayload(),
    })
    previewCols.value = preview.columns || []
    previewRows.value = preview.rows || []
    syncFields(previewCols.value)
  } catch (e) {
    previewError.value = errText(e)
  } finally {
    previewLoading.value = false
  }
}

// Rebuild the column→field mapping from the detected columns, keeping any prior
// target name / type / include choice for a column that's still present.
function syncFields(columns) {
  const prev = new Map((t.value.fields || []).map(f => [f.source, f]))
  t.value.fields = columns.map(name => {
    const existing = prev.get(name)
    return existing
      ? { source: name, target: existing.target, kind: existing.kind, include: existing.include }
      : { source: name, target: name, kind: 'auto', include: true }
  })
}

const includedFields = computed(() =>
  (t.value.fields || []).filter(f => f.include && String(f.target).trim() !== '')
)

// Re-run the preview when the CSV options change (they alter how the file parses).
watch(
  () => [t.value.csv.delimiter, t.value.csv.other, t.value.csv.qualifier, t.value.csv.skipLines, t.value.csv.hasHeader],
  () => { if (t.value.filePath) loadPreview() }
)

// ── run ────────────────────────────────────────────────────────
const canRun = computed(() =>
  !!t.value.filePath &&
  String(t.value.targetDb).trim() !== '' &&
  String(t.value.targetColl).trim() !== ''
)

function mappingPayload() {
  return includedFields.value.map(f => ({
    source: f.source,
    target: String(f.target).trim(),
    kind: f.kind,
  }))
}

async function run() {
  if (!canRun.value) return
  running.value = true
  error.value = null
  try {
    const count = await invoke('import_collection_mapped', {
      id: t.value.connId,
      database: String(t.value.targetDb).trim(),
      collection: String(t.value.targetColl).trim(),
      path: t.value.filePath,
      format: 'csv',
      mapping: mappingPayload(),
      csv: csvPayload(),
    })
    showToast(`Imported ${count} document${count === 1 ? '' : 's'}`)
    onImported(t.value.connId)
    done.value = { count: count }
  } catch (e) {
    setError(e)
  } finally {
    running.value = false
  }
}

function reset() {
  done.value = null
  error.value = null
}
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
      <StateMessage mode="empty" :label="`Imported ${done.count} document${done.count === 1 ? '' : 's'}`" />
      <BaseButton variant="ghost" size="sm" bordered @click="reset">Import more</BaseButton>
    </div>

    <template v-else>
      <!-- sub-tabs -->
      <div class="sub-tabs">
        <button
          v-for="st in SUB_TABS"
          :key="st.value"
          class="sub-tab"
          :class="{ active: t.subTab === st.value }"
          @click="t.subTab = st.value"
        >{{ st.label }}</button>
      </div>

      <div class="imp-scroll">
        <!-- ── SOURCE OPTIONS ── -->
        <template v-if="t.subTab === 'source'">
          <section class="imp-sec">
            <h3 class="imp-h">Import source</h3>
            <div class="src-line">
              <label class="radio"><BaseRadio v-model="t.sourceType" value="clipboard" /> Clipboard</label>
              <label class="radio"><BaseRadio v-model="t.sourceType" value="file" /> File</label>
              <BaseInput
                :model-value="sourceName"
                class="src-path"
                readonly
                placeholder="No source selected"
              />
              <BaseButton v-if="t.sourceType === 'file'" variant="ghost" size="sm" bordered @click="selectFile">
                <BaseIcon name="import" :size="16" class="ic" /> Select file
              </BaseButton>
              <BaseButton v-else variant="ghost" size="sm" bordered @click="pasteFromClipboard">
                <BaseIcon name="paste" :size="16" class="ic" /> Paste from clipboard
              </BaseButton>
            </div>
          </section>

          <section class="imp-sec">
            <h3 class="imp-h">CSV options</h3>
            <div class="csv-grid">
              <label class="csv-f">Delimiter:
                <BaseSelect v-model="t.csv.delimiter" class="csv-select" :options="DELIMITERS" size="sm" />
              </label>
              <label class="csv-f">Other:
                <BaseInput v-model="t.csv.other" class="csv-other" :disabled="t.csv.delimiter !== 'other'" maxlength="1" />
              </label>
              <label class="csv-f">Skip first &lt;n&gt; lines:
                <NumberStepper v-model="t.csv.skipLines" :min="0" class="csv-skip" />
              </label>
            </div>
            <div class="csv-grid">
              <label class="csv-f">Text qualifier:
                <BaseInput v-model="t.csv.qualifier" class="csv-other" maxlength="1" />
              </label>
              <label class="csv-f csv-check">
                <BaseCheckbox v-model="t.csv.hasHeader" />
                File contains header with field names
              </label>
            </div>
          </section>

          <section class="imp-sec">
            <h3 class="imp-h">Import source preview (first {{ previewRows.length }} row{{ previewRows.length === 1 ? '' : 's' }})</h3>
            <div class="prev-wrap">
              <StateMessage v-if="previewLoading" mode="loading" label="Loading preview…" />
              <StateMessage v-else-if="previewError" mode="error" :message="previewError" />
              <StateMessage v-else-if="!t.filePath" mode="empty" label="Choose a source to preview" />
              <table v-else-if="previewCols.length" class="prev-table">
                <thead><tr><th v-for="c in previewCols" :key="c">{{ c }}</th></tr></thead>
                <tbody>
                  <tr v-for="(row, ri) in previewRows" :key="ri">
                    <td v-for="c in previewCols" :key="c" :title="cellText(row[c])">{{ cellText(row[c]) }}</td>
                  </tr>
                </tbody>
              </table>
              <StateMessage v-else mode="empty" label="No rows detected" />
            </div>
          </section>
        </template>

        <!-- ── TARGET OPTIONS ── -->
        <template v-else>
          <section class="imp-sec">
            <h3 class="imp-h">Target</h3>
            <div class="tgt-grid">
              <label class="csv-f">Database:
                <BaseInput v-model="t.targetDb" class="tgt-input" />
              </label>
              <label class="csv-f">Collection:
                <BaseInput v-model="t.targetColl" class="tgt-input" />
              </label>
              <label class="csv-f">Insertion mode:
                <BaseSelect v-model="t.mode" class="tgt-mode" :options="INSERT_MODES" size="sm" />
              </label>
            </div>
          </section>

          <section class="imp-sec">
            <h3 class="imp-h">Field mapping</h3>
            <HintText dim>Choose which columns to import, rename them, and pick a type. Detected from the source preview.</HintText>
            <div v-if="t.fields && t.fields.length" class="map-table-wrap">
              <div class="map-head">
                <span></span><span>Source column</span><span>Target field</span><span>Type</span>
              </div>
              <div class="map-rows">
                <div v-for="f in t.fields" :key="f.source" class="map-row">
                  <BaseCheckbox v-model="f.include" class="map-chk" />
                  <code class="map-field" :title="f.source">{{ f.source }}</code>
                  <BaseInput v-model="f.target" class="map-input" :disabled="!f.include" />
                  <BaseSelect v-model="f.kind" class="map-select" :options="BSON_KINDS" :disabled="!f.include" size="sm" />
                </div>
              </div>
            </div>
            <StateMessage v-else mode="empty" label="Select a source on the Source options tab to detect columns" />
          </section>
        </template>

        <StateMessage v-if="error" mode="error" :message="error" :code="errorCode" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.imp { display: flex; flex-direction: column; height: 100%; min-height: 0; }

.imp-toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-bottom: 1px solid var(--border-soft); flex: none;
}
.ic { color: var(--text-dim); }
.base-btn.run { min-width: 92px; justify-content: flex-start; border: 1px solid var(--green); }
.run .ic { color: var(--green); }

.sub-tabs { display: flex; gap: 4px; padding: 0 12px; border-bottom: 1px solid var(--border-soft); flex: none; }
.sub-tab {
  background: none; border: none; cursor: pointer;
  padding: 9px 10px; font-size: 12.5px; color: var(--text-faint);
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.sub-tab:hover { color: var(--text-dim); }
.sub-tab.active { color: var(--text); border-bottom-color: var(--accent); }

.imp-scroll { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 16px; }
.imp-sec { display: flex; flex-direction: column; gap: 8px; }
.imp-h { font-size: 13px; font-weight: 600; color: var(--text); margin: 0; }

.src-line { display: flex; align-items: center; gap: 12px; }
.radio { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-dim); cursor: pointer; }
.base-input.src-path { flex: 1; }

.csv-grid { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.csv-f { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-dim); }
.csv-check { cursor: pointer; }
.csv-select { min-width: 150px; }
.base-input.csv-other { width: 46px; text-align: center; }
.csv-skip { width: 110px; }

.tgt-grid { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.base-input.tgt-input { min-width: 200px; }
.tgt-mode { min-width: 200px; }

.prev-wrap { border: 1px solid var(--border-soft); border-radius: 6px; overflow: auto; min-height: 90px; }
.prev-table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
.prev-table th, .prev-table td {
  border-bottom: 1px solid var(--grid-line); border-right: 1px solid var(--grid-line);
  padding: 4px 8px; text-align: left; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis;
}
.prev-table th { position: sticky; top: 0; background: var(--bg-input); color: var(--text-dim); font-weight: 500; }
.prev-table td { color: var(--text); font-family: var(--mono); }

.map-table-wrap { border: 1px solid var(--border-soft); border-radius: 6px; overflow: hidden; }
.map-head, .map-row { display: grid; grid-template-columns: 28px 1fr 1fr 120px; gap: 10px; align-items: center; }
.map-head { padding: 7px 10px; background: var(--bg-input); border-bottom: 1px solid var(--border-soft); font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }
.map-rows { display: flex; flex-direction: column; }
.map-row { padding: 4px 10px; border-bottom: 1px solid var(--grid-line); }
.map-chk { justify-self: center; }
.map-field { font-family: var(--mono); font-size: 12.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.base-input.map-input { border-radius: 5px; padding: 3px 6px; font-size: 12px; }
.map-select { min-width: 110px; }

.imp-done { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
</style>
