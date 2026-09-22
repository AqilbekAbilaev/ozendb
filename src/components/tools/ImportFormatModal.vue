<script setup>
import { ref, computed } from 'vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseRadio from '../base/BaseRadio.vue'

// Studio-3T-style "Import format" picker: the first thing the user sees after
// choosing Import. It only selects an input format — on Configure it emits the
// chosen format and the caller opens the matching import surface. The formats we
// don't implement yet are listed (for parity with Studio 3T) but disabled.
const props = defineProps({
  // Always collection-scoped (the Import… action requires that level), and named in
  // the title so the destination is visible while picking a format.
  target: { type: Object, required: true },
})

const destination = computed(() => `${props.target.dbName}.${props.target.collName}`)
const emit = defineEmits(['configure', 'close'])

const FORMATS = [
  {
    value: 'json',
    label: 'JSON — Mongo shell, Studio 3T, mongoexport',
    desc: "Import collections from JSON-formatted files created with Studio 3T or 'mongoexport'-compatible tools.",
    enabled: true,
  },
  {
    value: 'csv',
    label: 'CSV',
    desc: 'Import a collection from a CSV file created with Studio 3T or other applications like MS Excel. You can preview the imported data and configure the import process.',
    enabled: true,
  },
  {
    value: 'sql',
    label: 'SQL database',
    desc: 'Import data from a live SQL database.',
    enabled: false,
  },
  {
    value: 'bson-folder',
    label: 'BSON — mongodump folder',
    desc: "Import databases and collections from a mongodump folder created with MongoDB's 'mongodump' tool, restored via 'mongorestore'.",
    enabled: false,
  },
  {
    value: 'bson-archive',
    label: 'BSON — mongodump archive',
    desc: "Import databases and collections from a mongodump '--archive' file, restored via 'mongorestore'.",
    enabled: false,
  },
  {
    value: 'collection',
    label: 'Another collection',
    desc: 'Import data from another collection, allowing you to specify how duplicates are handled.',
    enabled: false,
  },
]

const selected = ref('json')

function pick(fmt) {
  if (fmt.enabled) selected.value = fmt.value
}

function configure() {
  const fmt = FORMATS.find(f => f.value === selected.value)
  if (!fmt || !fmt.enabled) return
  emit('configure', selected.value)
}
</script>

<template>
  <BaseModal :title="`Import into ${destination}`" width="640px" max-width="94vw" @close="$emit('close')">
    <div class="ifm-head">
      <div class="ifm-title">Import format</div>
      <div class="ifm-sub">To start the import process, please select an input format</div>
    </div>

    <div class="ifm-list">
      <label
        v-for="fmt in FORMATS"
        :key="fmt.value"
        class="ifm-row"
        :class="{ disabled: !fmt.enabled, active: selected === fmt.value }"
        @click="pick(fmt)"
      >
        <BaseRadio :model-value="selected" :value="fmt.value" :disabled="!fmt.enabled" />
        <div class="ifm-text">
          <div class="ifm-label">{{ fmt.label }}</div>
          <div class="ifm-desc">{{ fmt.desc }}</div>
        </div>
      </label>
    </div>

    <div class="ifm-footer">
      <span class="ifm-spacer"></span>
      <BaseButton bordered @click="$emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" @click="configure">Configure</BaseButton>
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
  max-height: 60vh;
  overflow-y: auto;
}
.ifm-row {
  display: flex;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 6px;
  cursor: pointer;
  align-items: flex-start;
}
.ifm-row:hover:not(.disabled) { background: var(--bg-hover); }
.ifm-row.active { background: var(--bg-selected, var(--bg-hover)); }
.ifm-row.disabled { cursor: not-allowed; opacity: .5; }
.ifm-row .base-radio { margin-top: 1px; }

.ifm-text { display: flex; flex-direction: column; gap: 3px; }
.ifm-label { font-size: 13px; color: var(--text); font-weight: 500; }
.ifm-desc { font-size: 12px; color: var(--text-dim); line-height: 1.45; }

.ifm-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-soft);
}
.ifm-spacer { flex: 1; }
</style>
