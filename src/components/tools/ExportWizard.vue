<script setup>
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { errText, errCode } from '../../utils/errors'
import { useToast } from '../../composables/useToast'
import BaseSelect from '../base/BaseSelect.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import ReorderButtons from '../base/ReorderButtons.vue'
import HintText from '../base/HintText.vue'
import { cellText } from '../../utils/format'

const EXPORT_FORMATS = [
  { value: 'json', label: 'JSON' },
  { value: 'csv',  label: 'CSV' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
]

// Stepped Export wizard for a single collection: sample the collection, choose /
// reorder / rename the fields (optionally coercing a type), pick a format, preview,
// then run (`export_collection_fields`). Import moved to its own workspace tab
// (ImportPane), so this component is export-only.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, dbName, collName }
})
const emit = defineEmits(['close'])
const { showToast } = useToast()

// The per-field type coercions the backend understands. 'auto' keeps the value
// as parsed (no coercion).
const KINDS = [
  { value: 'auto', label: 'Auto' },
  { value: 'string', label: 'String' },
  { value: 'int', label: 'Int32' },
  { value: 'long', label: 'Int64' },
  { value: 'double', label: 'Double' },
  { value: 'bool', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'objectId', label: 'ObjectId' },
]

const PREVIEW_LIMIT = 20

const step = ref(0)
const steps = ['Select fields', 'Preview & run']

const loading = ref(false)
const error = ref(null)
const errorCode = ref(null)
const running = ref(false)

// Chosen output format.
const format = ref('json')
// Export only documents added since this collection's last incremental export (tracked
// by _id on the backend).
const incremental = ref(false)

// [{ source, target, kind, include }] — the mapping the user edits.
const fields = ref([])
// Sample rows (objects keyed by source column) for the preview.
const sampleRows = ref([])

const includedFields = computed(() =>
  fields.value.filter(f => f.include && String(f.target).trim() !== '')
)

onMounted(loadCollectionSample)

function setError(e) {
  error.value = errText(e)
  errorCode.value = errCode(e)
}

// Sample the collection to discover the fields to offer.
async function loadCollectionSample() {
  loading.value = true
  error.value = null
  try {
    const docs = await invoke('find_documents', {
      id: props.target.connId,
      database: props.target.dbName,
      collection: props.target.collName,
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
    fields.value = cols.map(name => ({ source: name, target: name, kind: 'auto', include: true }))
  } catch (e) {
    setError(e)
  } finally {
    loading.value = false
  }
}

// ── field reordering ───────────────────────────────────────────
function moveField(index, delta) {
  const next = index + delta
  if (next < 0 || next >= fields.value.length) return
  const arr = fields.value
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
  if (step.value < steps.length - 1) step.value += 1
}
function back() {
  error.value = null
  if (step.value > 0) step.value -= 1
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
      defaultPath: `${props.target.collName}.${format.value}`,
      filters: [{ name: format.value.toUpperCase(), extensions: [format.value] }],
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
      id: props.target.connId,
      database: props.target.dbName,
      collection: props.target.collName,
      path: String(path),
      format: format.value,
      fields: mappingPayload(),
      incremental: incremental.value,
    })
    showToast(`Exported ${count} document${count === 1 ? '' : 's'} to ${format.value.toUpperCase()}`)
    emit('close')
  } catch (e) {
    setError(e)
  } finally {
    running.value = false
  }
}

const isLastStep = computed(() => step.value === steps.length - 1)
const titleText = computed(() => `Export — ${props.target.dbName}.${props.target.collName}`)
</script>

<template>
  <BaseModal :title="titleText" width="720px" max-width="94vw" @close="$emit('close')">

    <!-- step indicator -->
    <div class="iew-steps">
      <span
        v-for="(label, i) in steps"
        :key="label"
        class="iew-step"
        :class="{ active: i === step, done: i < step }"
      >
        <span class="iew-dot">{{ i + 1 }}</span>{{ label }}
      </span>
    </div>

    <div class="iew-body">
      <StateMessage v-if="loading" mode="loading" label="Working…" />
      <StateMessage
        v-else-if="error && !fields.length"
        mode="error"
        :message="error"
        :code="errorCode"
      />

      <!-- Field selection (step 0) -->
      <template v-else-if="step === 0">
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
          <div v-for="(f, i) in fields" :key="f.source" class="iew-row">
            <BaseCheckbox v-model="f.include" class="iew-chk" />
            <code class="iew-field" :title="f.source">{{ f.source }}</code>
            <BaseInput v-model="f.target" class="iew-input" :disabled="!f.include" />
            <BaseSelect v-model="f.kind" class="iew-select" :options="KINDS" :disabled="!f.include" size="sm" />
            <span class="iew-order">
              <ReorderButtons
                :up-disabled="i === 0"
                :down-disabled="i === fields.length - 1"
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
              <BaseSelect v-model="format" class="iew-select" :options="EXPORT_FORMATS" size="sm" />
            </label>
            <label class="iew-f iew-inc" title="Export only documents added since this collection's last incremental export (tracked by _id)">
              <BaseCheckbox v-model="incremental" />
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
        <StateMessage v-if="error" mode="error" :message="error" :code="errorCode" />
      </template>
    </div>

    <div class="iew-footer">
      <BaseButton v-if="step > 0" bordered :disabled="running" @click="back">Back</BaseButton>
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
      >{{ running ? 'Exporting…' : 'Run export' }}</BaseButton>
    </div>
  </BaseModal>
</template>

<style scoped>
.iew-steps {
  display: flex;
  gap: 18px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-soft);
  font-size: 12px;
  color: var(--text-faint);
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
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 240px;
  max-height: 66vh;
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
.iew-table-wrap { overflow: auto; border: 1px solid var(--border-soft); border-radius: 6px; }
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

.iew-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-soft);
}
.iew-spacer { flex: 1; }
</style>
