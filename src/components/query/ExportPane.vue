<script setup>
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { errText, errCode } from '../../utils/errors'
import { useToast } from '../../composables/useToast'
import BaseSelect from '../base/BaseSelect.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import ReorderButtons from '../base/ReorderButtons.vue'
import HintText from '../base/HintText.vue'
import CollectionCrumbs from '../base/CollectionCrumbs.vue'
import { cellText } from '../../utils/format'
import { EXPORT_FORMATS, BSON_KINDS, PREVIEW_LIMIT } from '../../constants/dataTools'

// Stepped Export wizard for a single collection: sample the collection, choose /
// reorder / rename the fields (optionally coercing a type), pick a format, preview,
// then run (`export_collection_fields`).
//
// This is a workspace tab, not a modal, so the wizard's working state (step, format,
// field mapping) lives on the tab object — the pane is unmounted whenever the user
// switches tabs, and local refs would reset the wizard every time.
const props = defineProps({
  activeTab: { type: Object, required: true },
})
const { showToast } = useToast()

// Sample rows back the preview only. They're re-fetched on mount rather than stored,
// so a restored tab previews the collection's current contents, not a stale snapshot.
const sampleRows = ref([])
const loading = ref(false)
const error = ref(null)
const errorCode = ref(null)
const running = ref(false)

const steps = ['Select fields', 'Preview & run']

const t = computed(() => props.activeTab)
const includedFields = computed(() =>
  t.value.fields.filter(f => f.include && String(f.target).trim() !== '')
)

onMounted(loadCollectionSample)

function setError(e) {
  error.value = errText(e)
  errorCode.value = errCode(e)
}

// Sample the collection to discover the fields to offer. An existing mapping (kept
// across a tab switch, or restored from the last session) wins: only columns it
// doesn't already mention are appended, so the user's selections and renames survive
// both a re-sample and a collection that has since grown new fields.
async function loadCollectionSample() {
  loading.value = true
  error.value = null
  try {
    const docs = await invoke('find_documents', {
      id: t.value.connId,
      database: t.value.dbName,
      collection: t.value.collName,
      filter: '{}',
      projection: '{}',
      sort: '{}',
      skip: 0,
      limit: PREVIEW_LIMIT,
    })
    sampleRows.value = docs || []
    const cols = []
    for (const doc of sampleRows.value) {
      for (const key of Object.keys(doc)) {
        if (!cols.includes(key)) cols.push(key)
      }
    }
    const known = new Set(t.value.fields.map(f => f.source))
    for (const name of cols) {
      if (!known.has(name)) {
        t.value.fields.push({ source: name, target: name, kind: 'auto', include: true })
      }
    }
  } catch (e) {
    setError(e)
  } finally {
    loading.value = false
  }
}

// ── field reordering ───────────────────────────────────────────
function moveField(index, delta) {
  const next = index + delta
  if (next < 0 || next >= t.value.fields.length) return
  const arr = t.value.fields
  const tmp = arr[index]
  arr[index] = arr[next]
  arr[next] = tmp
}

// ── preview table ──────────────────────────────────────────────
// Columns shown in the preview = the target names of the included fields.
const previewColumns = computed(() => includedFields.value.map(f => f.target))

// Row objects rebuilt as { targetName: sourceValue } so the preview reflects
// renaming/selection. (Type coercion is applied server-side on run.)
const previewRows = computed(() =>
  sampleRows.value.map(row => {
    const out = {}
    for (const f of includedFields.value) out[f.target] = row[f.source]
    return out
  })
)

// ── navigation ─────────────────────────────────────────────────
const canGoNext = computed(() => includedFields.value.length > 0)

function next() {
  error.value = null
  if (t.value.step < steps.length - 1) t.value.step += 1
}
function back() {
  error.value = null
  if (t.value.step > 0) t.value.step -= 1
}

// The field payload sent to the backend.
function mappingPayload() {
  return includedFields.value.map(f => ({
    source: f.source,
    target: String(f.target).trim(),
    kind: f.kind,
  }))
}

// ── run ────────────────────────────────────────────────────────
async function run() {
  let path
  try {
    path = await saveDialog({
      defaultPath: `${t.value.collName}.${t.value.format}`,
      filters: [{ name: t.value.format.toUpperCase(), extensions: [t.value.format] }],
    })
  } catch (e) {
    setError(e)
    return
  }
  if (!path) return
  running.value = true
  error.value = null
  try {
    const count = await invoke('export_collection_fields', {
      id: t.value.connId,
      database: t.value.dbName,
      collection: t.value.collName,
      path: String(path),
      format: t.value.format,
      fields: mappingPayload(),
      incremental: t.value.incremental,
    })
    // The tab stays open on success so the mapping can be tweaked and re-run; the
    // result banner replaces the modal's close-on-success.
    t.value.result = { count: count, path: String(path) }
    showToast(`Exported ${count} document${count === 1 ? '' : 's'} to ${t.value.format.toUpperCase()}`)
  } catch (e) {
    setError(e)
  } finally {
    running.value = false
  }
}

const isLastStep = computed(() => t.value.step === steps.length - 1)
</script>

<template>
  <div class="export-pane">
    <CollectionCrumbs
      :conn="activeTab.connName" :db="activeTab.dbName" :coll="activeTab.collName"
      icon="export" label="Export"
    />

    <!-- step indicator -->
    <div class="iew-steps">
      <span
        v-for="(label, i) in steps"
        :key="label"
        class="iew-step"
        :class="{ active: i === activeTab.step, done: i < activeTab.step }"
      >
        <span class="iew-dot">{{ i + 1 }}</span>{{ label }}
      </span>
    </div>

    <div class="iew-body">
      <StateMessage v-if="loading" mode="loading" label="Working…" />
      <StateMessage
        v-else-if="error && !activeTab.fields.length"
        mode="error"
        :message="error"
        :code="errorCode"
      />

      <!-- Field selection (step 0) -->
      <template v-else-if="activeTab.step === 0">
        <HintText dim>
          Choose which fields to export, rename or reorder them, and optionally coerce a type.
        </HintText>
        <div class="iew-head">
          <span></span>
          <span>Field</span>
          <span>Export as</span>
          <span>Type</span>
          <span>Order</span>
        </div>
        <div class="iew-rows">
          <div v-for="(f, i) in activeTab.fields" :key="f.source" class="iew-row">
            <BaseCheckbox v-model="f.include" class="iew-chk" />
            <code class="iew-field" :title="f.source">{{ f.source }}</code>
            <BaseInput v-model="f.target" class="iew-input" :disabled="!f.include" />
            <BaseSelect v-model="f.kind" class="iew-select" :options="BSON_KINDS" :disabled="!f.include" size="sm" />
            <span class="iew-order">
              <ReorderButtons
                :up-disabled="i === 0"
                :down-disabled="i === activeTab.fields.length - 1"
                @up="moveField(i, -1)"
                @down="moveField(i, 1)"
              />
            </span>
          </div>
        </div>
      </template>

      <!-- Preview & run (last step) -->
      <template v-else-if="isLastStep">
        <div class="iew-preview-top">
          <HintText dim>
            Preview of the first {{ previewRows.length }} row{{ previewRows.length === 1 ? '' : 's' }}.
          </HintText>
          <div class="iew-export-opts">
            <label class="iew-f">
              Format
              <BaseSelect v-model="activeTab.format" class="iew-select" :options="EXPORT_FORMATS" size="sm" />
            </label>
            <label class="iew-f iew-inc" title="Export only documents added since this collection's last incremental export (tracked by _id)">
              <BaseCheckbox v-model="activeTab.incremental" />
              Incremental (new only)
            </label>
          </div>
        </div>
        <div class="iew-table-wrap">
          <table class="iew-table" v-if="previewColumns.length">
            <thead>
              <tr><th v-for="c in previewColumns" :key="c">{{ c }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in previewRows" :key="ri">
                <td v-for="c in previewColumns" :key="c" :title="cellText(row[c])">{{ cellText(row[c]) }}</td>
              </tr>
            </tbody>
          </table>
          <StateMessage v-else mode="empty" label="No fields selected" />
        </div>
        <div v-if="activeTab.result" class="iew-result">
          Exported {{ activeTab.result.count }}
          document{{ activeTab.result.count === 1 ? '' : 's' }} to
          <code :title="activeTab.result.path">{{ activeTab.result.path }}</code>
        </div>
        <StateMessage v-if="error" mode="error" :message="error" :code="errorCode" />
      </template>
    </div>

    <div class="iew-footer">
      <BaseButton v-if="activeTab.step > 0" bordered :disabled="running" @click="back">Back</BaseButton>
      <span class="iew-spacer"></span>
      <BaseButton
        v-if="!isLastStep"
        variant="primary"
        :disabled="!canGoNext || loading"
        @click="next"
      >Next</BaseButton>
      <BaseButton
        v-else
        variant="primary"
        :disabled="running || !includedFields.length"
        @click="run"
      >{{ running ? 'Exporting…' : (activeTab.result ? 'Run again' : 'Run export') }}</BaseButton>
    </div>
  </div>
</template>

<style scoped>
.export-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-window); }

.iew-steps {
  display: flex;
  gap: 18px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-soft);
  font-size: 12px;
  color: var(--text-faint);
  flex: none;
}
.iew-step { display: flex; align-items: center; gap: 6px; }
.iew-step.active { color: var(--text); }
.iew-step.done { color: var(--text-dim); }
.iew-dot {
  display: inline-grid;
  place-items: center;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--bg-input);
  border: 1px solid var(--border);
  font-size: 11px;
}
.iew-step.active .iew-dot { background: var(--accent); color: #fff; border-color: var(--accent); }

.iew-body {
  flex: 1;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
}

.iew-head, .iew-row {
  display: grid;
  grid-template-columns: 28px 1fr 1fr 120px auto;
  gap: 10px;
  align-items: center;
}
.iew-head {
  padding: 0 4px 6px;
  border-bottom: 1px solid var(--border-soft);
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.iew-rows { overflow-y: auto; display: flex; flex-direction: column; }
.iew-row {
  padding: 5px 4px;
  border-bottom: 1px solid var(--grid-line);
}
.iew-chk { justify-self: center; }
.iew-field {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.base-input.iew-input {
  border-radius: 5px;
  padding: 3px 6px;
  font-size: 12px;
}
.iew-select { min-width: 110px; }
.iew-order { display: flex; gap: 4px; }

.iew-f { font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
.iew-export-opts { display: flex; align-items: center; gap: 16px; flex: none; }
.iew-inc { cursor: pointer; }
.iew-inc input { cursor: pointer; }

.iew-preview-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.iew-table-wrap { flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border-soft); border-radius: 6px; }
.iew-table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
.iew-table th, .iew-table td {
  border-bottom: 1px solid var(--grid-line);
  border-right: 1px solid var(--grid-line);
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.iew-table th {
  position: sticky;
  top: 0;
  background: var(--bg-input);
  color: var(--text-dim);
  font-weight: 500;
}
.iew-table td { color: var(--text); font-family: var(--mono); }

.iew-result {
  flex: none;
  font-size: 12px;
  color: var(--text-dim);
  border: 1px solid var(--border-soft);
  border-left: 2px solid var(--green);
  border-radius: 5px;
  padding: 7px 10px;
}
.iew-result code {
  font-family: var(--mono);
  color: var(--text);
  word-break: break-all;
}

.iew-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-soft);
  flex: none;
}
.iew-spacer { flex: 1; }
</style>
