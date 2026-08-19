<script setup>
// Collection → Update Dialog. Runs an update against documents matching a query
// filter, using an operator update document ({ $set: … }). Query and Update live on
// separate tabs (Query / Update); Upsert and Multi mirror the driver's update options
// (Multi on = update_many, off = update_one). Query text is shell syntax, parsed to
// Extended JSON by the shared query parser (same as the query bar).
import { ref, computed, watch } from 'vue'
import { updateMany } from '../../engines/mongodb/api/documents'
import { countDocuments } from '../../engines/mongodb/api/queries'
import { errText } from '../../utils/errors'
import { parseField } from '../../utils/queryParser'
import { predefinedQuery, hasSelectedDocs } from '../../utils/predefinedQuery'
import BaseIcon from '../base/BaseIcon.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseModalBody from '../base/BaseModalBody.vue'
import BaseModalFoot from '../base/BaseModalFoot.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import TabStrip from '../base/TabStrip.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseButton from '../base/BaseButton.vue'
import CodeEditor from '../base/CodeEditor.vue'
import FieldError from '../base/FieldError.vue'
import HintText from '../base/HintText.vue'

const props = defineProps({
  activeTab: { type: Object, required: true },
})
const emit = defineEmits(['close', 'done'])

const pane   = ref('query')        // which tab is showing: 'query' | 'update'
const preset = ref('')             // "Apply predefined query" selection (shown in the dropdown)
const filter = ref('{}')
const update = ref('{\n  "$set": {\n    \n  }\n}')
const upsert = ref(false)          // insert a new document when nothing matches
const multi  = ref(true)           // true = update every match (update_many)
const error  = ref(null)
const busy   = ref(false)
// Inline JSON-validation feedback from the Validate JSON button. `{ ok, text }`.
const validation = ref(null)
// Scope guard, mirroring the Delete Dialog: the user must "Find matches" (a count)
// for the current query before Update enables, so a mass update (default {} matches
// all) can never run against a scope they haven't seen. Editing the query
// invalidates the count. The count reflects the filter only — the update operators
// don't change which documents are matched.
const matched = ref(null)          // count for `countedFilter`, or null before/after edits
const countedFilter = ref(null)    // the exact filter text `matched` was counted for

watch(filter, () => { matched.value = null; countedFilter.value = null; validation.value = null })
watch(update, () => { validation.value = null })

const presetOptions = computed(() => [
  { value: 'selected', label: 'Selected Document(s)', disabled: !hasSelectedDocs(props.activeTab) },
  { value: 'current',  label: 'Search Query from Collection View' },
  { value: 'all',      label: 'All Documents' },
])

// Show the picked option in the dropdown and apply its query into the Query field,
// switching to the Query tab so the change is visible.
function onPreset(kind) {
  preset.value = kind
  if (!kind) return
  filter.value = predefinedQuery(kind, props.activeTab)
  pane.value = 'query'
}

// Validate JSON parses whichever tab is showing and reports the result inline,
// without touching the database. The Update tab additionally requires operator form.
function onValidate() {
  error.value = null
  if (pane.value === 'query') {
    const pf = parseField(filter.value)
    validation.value = pf.ok
      ? { ok: true, text: 'Query is valid JSON.' }
      : { ok: false, text: 'Query: ' + pf.error }
    return
  }
  const pu = parseField(update.value)
  if (!pu.ok) { validation.value = { ok: false, text: 'Update: ' + pu.error }; return }
  // parseField hands back canonical Extended JSON text; its top-level keys are the
  // update's operators. Operator form = at least one key, all starting with `$`.
  const keys = Object.keys(JSON.parse(pu.ejson))
  const isOperator = keys.length > 0 && keys.every(k => k.startsWith('$'))
  validation.value = isOperator
    ? { ok: true, text: 'Update is valid JSON.' }
    : { ok: false, text: 'Update must use operators, e.g. { "$set": { "field": value } }' }
}

async function onCount() {
  error.value = null
  const pf = parseField(filter.value)
  if (!pf.ok) { error.value = 'Query: ' + pf.error; pane.value = 'query'; return }
  busy.value = true
  try {
    const total = await countDocuments(
      { connectionId: props.activeTab.connectionId, database: props.activeTab.dbName, collection: props.activeTab.collectionName },
      pf.ejson,
    )
    matched.value = total
    countedFilter.value = filter.value
  } catch (e) {
    error.value = errText(e)
  } finally {
    busy.value = false
  }
}

async function onRun() {
  // Guard: only update what was counted for the current, unchanged query.
  if (matched.value === null || countedFilter.value !== filter.value) return
  error.value = null
  const pf = parseField(filter.value)
  if (!pf.ok) { error.value = 'Query: ' + pf.error; pane.value = 'query'; return }
  const pu = parseField(update.value)
  if (!pu.ok) { error.value = 'Update: ' + pu.error; pane.value = 'update'; return }
  busy.value = true
  try {
    const modified = await updateMany(
      { connectionId: props.activeTab.connectionId, database: props.activeTab.dbName, collection: props.activeTab.collectionName },
      pf.ejson,
      pu.ejson,
      { upsert: upsert.value, multi: multi.value },
    )
    emit('done', `Updated ${modified} document${modified !== 1 ? 's' : ''}`)
  } catch (e) {
    error.value = errText(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal title="Update Documents" width="560px" max-width="94vw" @close="$emit('close')">
      <div class="uw-tabs">
        <TabStrip
          :model-value="pane"
          :options="[{ value: 'query', label: 'Query' }, { value: 'update', label: 'Update' }]"
          @update:model-value="pane = $event"
        />
      </div>

      <BaseModalBody>
        <HintText dim>
          <template v-if="pane === 'query'">Update the document(s) in
            <code>{{ activeTab.collectionName }}</code> matching the query below:</template>
          <template v-else>Update operators to apply, e.g. <code>{ "$set": { "field": 1 } }</code></template>
        </HintText>

        <CodeEditor v-if="pane === 'query'" class="uw-editor" v-model="filter" />
        <CodeEditor v-else class="uw-editor" v-model="update" />

        <div class="pq-row">
          <span class="pq-lbl">Apply predefined query:</span>
          <BaseSelect class="pq-select" :model-value="preset" :options="presetOptions"
            placeholder="Choose…" @update:model-value="onPreset" />
        </div>

        <div class="uw-opts">
          <label class="uw-opt">
            <BaseCheckbox v-model="upsert" />
            <span>Upsert</span>
            <BaseIcon name="info" :size="13" class="uw-info"
              title="Insert a new document when no existing document matches the query." />
          </label>
          <label class="uw-opt">
            <BaseCheckbox v-model="multi" />
            <span>Multi</span>
            <BaseIcon name="info" :size="13" class="uw-info"
              title="Update every matching document. When off, only the first match is updated." />
          </label>
        </div>

        <div class="uw-count" v-if="matched !== null && countedFilter === filter">
          <BaseIcon name="count" :size="14" />
          {{ matched.toLocaleString() }} document{{ matched !== 1 ? 's' : '' }} match this query.
        </div>

        <div v-if="validation" class="uw-msg" :class="{ ok: validation.ok, bad: !validation.ok }">
          <BaseIcon :name="validation.ok ? 'check' : 'close'" :size="13" />
          {{ validation.text }}
        </div>

        <FieldError :text="error" />
      </BaseModalBody>

      <BaseModalFoot>
        <template #left>
          <BaseButton @click="onValidate">Validate JSON</BaseButton>
          <BaseButton :disabled="busy" @click="onCount">Find matches</BaseButton>
        </template>
        <BaseButton @click="$emit('close')">Cancel</BaseButton>
        <BaseButton
          variant="primary"
          :disabled="busy || matched === null || countedFilter !== filter"
          @click="onRun"
        >{{ busy ? 'Updating…' : (matched !== null && countedFilter === filter ? `Update ${matched.toLocaleString()}` : 'Update') }}</BaseButton>
      </BaseModalFoot>
  </BaseModal>
</template>

<style scoped>
.uw-tabs { display: flex; align-items: stretch; padding: 0 14px; border-bottom: 1px solid var(--border); flex: none; }
.uw-hint code { font-family: var(--mono); color: var(--text); }
.uw-editor {
  /* ~10 rows: 13px font × 1.7 line-height + CodeMirror's content padding. */
  height: 230px; border: 1px solid var(--border); border-radius: 5px; overflow: hidden;
  background: var(--bg-input);
}
.uw-editor:focus-within { border-color: var(--accent); }
.pq-row { display: flex; align-items: center; gap: 10px; }
.pq-lbl { font-size: 12.5px; color: var(--text-dim); flex: none; }
.pq-select { flex: 1; min-width: 0; }
.uw-opts { display: flex; align-items: center; gap: 22px; }
.uw-opt { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text); cursor: pointer; }
.uw-info { color: var(--accent); cursor: help; }
.uw-count { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text); }
.uw-msg { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.uw-msg.ok { color: var(--success-text); }
.uw-msg.bad { color: var(--danger-text); }

</style>
