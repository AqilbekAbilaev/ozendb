<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { analyzeSchema, exportSchema } from '../../engines/mongodb/api/schema'
import { errText, errCode } from '../../utils/errors'
import BaseIcon from '../base/BaseIcon.vue'
import BaseSelect from '../base/BaseSelect.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseButton from '../base/BaseButton.vue'
import CollectionCrumbs from '../base/CollectionCrumbs.vue'

// The Schema tab samples documents server-side and infers the field/type shape, the way
// Studio-3T's Schema Explorer does. Each tab analyzes its own collection independently and
// re-runs when the tab's collection changes.
const props = defineProps({
  activeTab: { type: Object, required: true },  // { connId, connName, dbName, collName }
})

const SAMPLE_SIZES = [100, 500, 1000, 5000]
const sampleSizeOptions = SAMPLE_SIZES.map((n) => ({ value: n, label: String(n) }))
const EXPORT_FORMAT_OPTIONS = [
  { value: 'csv',  label: 'CSV' },
  { value: 'docx', label: 'Word (.docx)' },
]

function onSampleSize(n) {
  sampleSize.value = n
  analyze()
}

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const report = ref(null)
const sampleSize = ref(1000)

async function analyze() {
  loading.value = true
  error.value = null
  errorCode.value = null
  try {
    report.value = await analyzeSchema(
      { connectionId: props.activeTab.connId, database: props.activeTab.dbName, collection: props.activeTab.collName },
      sampleSize.value,
    )
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
    report.value = null
  } finally {
    loading.value = false
  }
}

onMounted(analyze)
// Re-analyze if this tab is retargeted at a different collection.
watch(() => props.activeTab.connId + ':' + props.activeTab.dbName + ':' + props.activeTab.collName, () => {
  analyze()
})

const exporting = ref(false)
const exportMsg = ref(null)
const exportFormat = ref('csv')  // 'csv' | 'docx'

// Export the current schema report (Studio-3T's schema documentation) as CSV or a Word
// document. The backend re-samples with the same sample size so the file matches the view.
async function runSchemaExport() {
  const format = exportFormat.value
  const ext = format === 'docx' ? 'docx' : 'csv'
  let path
  try {
    path = await saveDialog({
      defaultPath: `${props.activeTab.collName}-schema.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })
  } catch (e) {
    exportMsg.value = errText(e)
    return
  }
  if (!path) return
  exporting.value = true
  exportMsg.value = null
  try {
    const count = await exportSchema(
      { connectionId: props.activeTab.connId, database: props.activeTab.dbName, collection: props.activeTab.collName },
      sampleSize.value,
      String(path),
      format,
    )
    exportMsg.value = `Exported ${count} field${count === 1 ? '' : 's'} to ${ext.toUpperCase()}`
  } catch (e) {
    exportMsg.value = errText(e)
  } finally {
    exporting.value = false
  }
}

// Depth for indentation: nesting is encoded in the dotted path.
function depth(path) {
  return (path.match(/\./g) || []).length
}

// The leaf key, so the tree reads like a field list rather than repeating the
// full dotted path at every level.
function leaf(path) {
  const parts = path.split('.')
  return parts[parts.length - 1]
}

function pct(count) {
  const total = report.value ? report.value.sampled : 0
  if (!total) return 0
  return Math.round((count / total) * 100)
}

// A per-type share relative to the documents that HAVE the field, so a field
// that is 60% string / 40% int reads clearly regardless of overall coverage.
function typePct(typeCount, present) {
  if (!present) return 0
  return Math.round((typeCount / present) * 100)
}

// Color a type badge by broad category, reusing existing cell tokens so it fits
// the palette in both dark and light themes.
function typeColor(name) {
  if (name === 'string') return 'var(--cell-str-green)'
  if (name === 'int' || name === 'long' || name === 'double' || name === 'decimal') return 'var(--cell-num)'
  if (name === 'object' || name === 'array') return 'var(--cell-key)'
  if (name === 'bool') return 'var(--cell-op)'
  if (name === 'null') return 'var(--text-faint)'
  return 'var(--text-dim)'
}

const fields = computed(() => (report.value ? report.value.fields : []))
</script>

<template>
  <div class="schema-pane">
    <!-- Breadcrumb (mirrors the collection tab) -->
    <CollectionCrumbs :conn="activeTab.connName" :db="activeTab.dbName" :coll="activeTab.collName" icon="schema" label="Schema" />

    <!-- Controls -->
    <div class="sc-controls">
      <label class="sc-sample">
        Sample size
        <BaseSelect :model-value="sampleSize" class="sc-select" :options="sampleSizeOptions"
          :disabled="loading" size="sm" @update:model-value="onSampleSize" />
      </label>
      <div class="sc-count" v-if="report && !loading">
        Sampled {{ report.sampled }} document{{ report.sampled === 1 ? '' : 's' }},
        {{ fields.length }} field{{ fields.length === 1 ? '' : 's' }}
      </div>
      <span v-if="exportMsg" class="sc-export-msg">{{ exportMsg }}</span>
      <BaseSelect
        v-model="exportFormat"
        class="sc-select sc-export-fmt"
        :class="{ 'no-count': !(report && !loading) }"
        :options="EXPORT_FORMAT_OPTIONS"
        :disabled="loading || exporting || !fields.length"
        size="sm"
      />
      <BaseButton
        size="sm"
        bordered
        type="button"
        :disabled="loading || exporting || !fields.length"
        @click="runSchemaExport"
      >
        <BaseIcon name="export" :size="13" /> {{ exporting ? 'Exporting…' : 'Export' }}
      </BaseButton>
    </div>

    <!-- Body -->
    <div class="sc-body">
      <StateMessage v-if="loading" mode="loading" label="Analyzing schema…" />
      <StateMessage
        v-else-if="error"
        mode="error"
        :message="error"
        :code="errorCode"
      />
      <StateMessage
        v-else-if="!fields.length"
        mode="empty"
        label="No documents to analyze"
      />
      <template v-else>
        <div class="sc-head">
          <span class="sc-h-field">Field</span>
          <span class="sc-h-types">Types</span>
          <span class="sc-h-cov">Coverage</span>
        </div>
        <div class="sc-rows">
          <div v-for="f in fields" :key="f.path" class="sc-row">
            <span class="sc-field" :style="{ paddingLeft: (depth(f.path) * 16 + 2) + 'px' }" :title="f.path">
              <span v-if="depth(f.path)" class="sc-nest-dot">└</span>
              {{ leaf(f.path) }}
            </span>
            <span class="sc-types">
              <span
                v-for="t in f.types"
                :key="t.bson_type"
                class="sc-type"
                :style="{ color: typeColor(t.bson_type) }"
              >
                {{ t.bson_type }}<span
                  v-if="f.types.length > 1"
                  class="sc-type-pct"
                > {{ typePct(t.count, f.present) }}%</span>
              </span>
            </span>
            <span class="sc-cov">
              <span class="sc-bar"><span class="sc-bar-fill" :style="{ width: pct(f.present) + '%' }"></span></span>
              <span class="sc-cov-pct">{{ pct(f.present) }}%</span>
            </span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.schema-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-window); }

/* Breadcrumb (mirrors the collection tab / Index Manager) */

.sc-controls {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  background: var(--bg-toolbar);
  border-bottom: 1px solid var(--border);
  flex: none;
}
.sc-sample {
  font-size: 12px;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  gap: 6px;
}
.sc-select { min-width: 96px; }
.sc-count { font-size: 12px; color: var(--text-faint); margin-left: auto; }
.sc-export-msg { font-size: 12px; color: var(--text-dim); }
.sc-export-fmt.no-count { margin-left: auto; }
.sc-export-fmt { margin-left: 0; }

.sc-body { flex: 1; min-height: 0; overflow: auto; padding: 8px 14px 0; }

.sc-head {
  display: grid;
  grid-template-columns: 1fr 1.1fr 120px;
  gap: 10px;
  padding: 0 8px 6px;
  position: sticky;
  top: 0;
  background: var(--bg-window);
  border-bottom: 1px solid var(--border-soft);
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.sc-rows {
  display: flex;
  flex-direction: column;
}
.sc-row {
  display: grid;
  grid-template-columns: 1fr 1.1fr 120px;
  gap: 10px;
  align-items: center;
  padding: 5px 8px;
  border-bottom: 1px solid var(--grid-line);
  font-size: 12.5px;
}
.sc-row:hover { background: var(--bg-hover); }
.sc-field {
  color: var(--text);
  font-family: var(--mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 5px;
}
.sc-nest-dot { color: var(--text-faint); flex: none; }
.sc-types {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
}
.sc-type { font-family: var(--mono); font-size: 12px; white-space: nowrap; }
.sc-type-pct { color: var(--text-faint); }
.sc-cov {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sc-bar {
  flex: 1;
  height: 6px;
  background: var(--bg-input);
  border-radius: 3px;
  overflow: hidden;
}
.sc-bar-fill { display: block; height: 100%; background: var(--accent); }
.sc-cov-pct { font-size: 12px; color: var(--text-dim); width: 34px; text-align: right; }
</style>
