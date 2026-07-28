<script setup>
import { computed, ref } from 'vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseRadio from '../base/BaseRadio.vue'

// Studio-3T-style "Export source" picker: the first thing the user sees after
// choosing Export, and the sibling of ImportFormatModal. It only decides *what* gets
// exported — on Next it emits the chosen source and the caller opens the Export tab,
// where the fields, format and preview are configured.
//
// Two of the sources depend on there being a matching open collection tab, so they
// enable only when the caller supplies one (see `target.query` / `target.selected`).
const props = defineProps({
  // { connId, connName, dbName, collName, query, selectedIds } — `query` is the tab's
  // current filter as EJSON (null when Export was opened from the sidebar), and
  // `selectedIds` the EJSON _id values of the rows selected in its grid.
  target: { type: Object, required: true },
})
const emit = defineEmits(['choose', 'close'])

const hasQuery = computed(() => {
  const q = props.target.query
  return typeof q === 'string' && q.trim() !== '' && q.trim() !== '{}'
})
const selectedCount = computed(() => (props.target.selectedIds || []).length)

const SOURCES = computed(() => [
  {
    value: 'collection',
    label: 'Entire Collection/View',
    desc: 'Export the entire collection/view.',
    enabled: true,
  },
  {
    value: 'query',
    label: 'Current Query Result',
    desc: hasQuery.value
      ? 'Export the documents matching the query in the open collection tab. The query is re-run when the export runs, so the file reflects the data at that moment.'
      : 'Export the current query result. Open a collection tab and run a query first — with no query, this is the same as exporting the entire collection.',
    enabled: hasQuery.value,
  },
  {
    value: 'selected',
    label: 'Selected Documents',
    desc: selectedCount.value
      ? `Export the ${selectedCount.value} document${selectedCount.value === 1 ? '' : 's'} selected in the grid, matched by _id.`
      : 'Export the currently selected document(s). Select one or more rows in a collection tab first.',
    enabled: selectedCount.value > 0,
  },
])

const selected = ref('collection')

function pick(source) {
  if (source.enabled) selected.value = source.value
}

function next() {
  const source = SOURCES.value.find(s => s.value === selected.value)
  if (!source || !source.enabled) return
  emit('choose', selected.value)
}
</script>

<template>
  <BaseModal title="Export" width="640px" max-width="94vw" @close="$emit('close')">
    <div class="ifm-head">
      <div class="ifm-title">Export source</div>
      <div class="ifm-sub">
        Please choose an export source —
        {{ target.dbName }}.{{ target.collName }}
      </div>
    </div>

    <div class="ifm-list">
      <label
        v-for="source in SOURCES"
        :key="source.value"
        class="ifm-row"
        :class="{ disabled: !source.enabled, active: selected === source.value }"
        @click="pick(source)"
      >
        <BaseRadio :model-value="selected" :value="source.value" :disabled="!source.enabled" />
        <div class="ifm-text">
          <div class="ifm-label">{{ source.label }}</div>
          <div class="ifm-desc">{{ source.desc }}</div>
        </div>
      </label>
    </div>

    <div class="ifm-footer">
      <span class="ifm-spacer"></span>
      <BaseButton bordered @click="$emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" @click="next">Next</BaseButton>
    </div>
  </BaseModal>
</template>

<style scoped>
.ifm-head {
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--border-soft);
}
.ifm-title { font-size: 14px; font-weight: 600; color: var(--text); }
.ifm-sub { font-size: 12px; color: var(--text-faint); margin-top: 3px; }

.ifm-list {
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
}
.ifm-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: start;
  padding: 10px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.ifm-row:hover:not(.disabled) { background: var(--bg-row-alt); }
.ifm-row.active { background: var(--bg-row-alt); }
.ifm-row.disabled { cursor: default; opacity: .55; }
.ifm-label { font-size: 13px; color: var(--text); }
.ifm-desc { font-size: 11.5px; color: var(--text-faint); margin-top: 3px; line-height: 1.45; }

.ifm-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-soft);
}
.ifm-spacer { flex: 1; }
</style>
