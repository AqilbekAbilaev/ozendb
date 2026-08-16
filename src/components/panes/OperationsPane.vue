<script setup>
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'

// The Operations pane: a bottom-docked, read-only log of every long-running operation
// the app has run (fed from the backend registry via useOperations). Purely display +
// two actions (cancel a running op, clear the finished log) emitted up to App.vue.
const props = defineProps({
  operations: { type: Array, default: () => [] },
})

const emit = defineEmits(['clear', 'close'])

// op_type → the BaseIcon used as the row's leading glyph. Unknown types fall back to
// a generic run icon. (Only find/aggregate appear today; the rest are ready for the
// later phases that instrument exports/imports/etc.)
const TYPE_ICON = {
  find: 'search',
  aggregate: 'aggregate',
  export: 'export',
  import: 'import',
  copy: 'duplicate',
  index: 'anchor',
  gridfs: 'collection',
  mapReduce: 'aggregate',
}
function typeIcon(op) {
  return TYPE_ICON[op.opType] || 'run'
}

function startedText(op) {
  if (!op.startedAt) return ''
  return new Date(op.startedAt).toLocaleTimeString()
}

function durationText(op) {
  if (op.status === 'running' || op.elapsedMs == null) return '—'
  if (op.elapsedMs < 1000) return `${op.elapsedMs} ms`
  return `${(op.elapsedMs / 1000).toFixed(2)} s`
}

const hasFinished = () => props.operations.some((op) => op.status !== 'running')
</script>

<template>
  <div class="ops">
    <div class="ops-head">
      <span class="ops-title">Operations</span>
      <span class="ops-count" v-if="operations.length">{{ operations.length }}</span>
      <span class="ops-spacer"></span>
      <BaseButton
        variant="ghost"
        size="sm"
        type="button"
        :disabled="!hasFinished()"
        @click="emit('clear')"
      >
        <BaseIcon name="trash" :size="13" /> Clear finished
      </BaseButton>
      <BaseButton icon="close" :icon-size="14" type="button" title="Hide operations" @click="emit('close')" />
    </div>

    <div class="ops-body">
      <div v-if="!operations.length" class="ops-empty">
        No operations yet. Running a query, export, or import will show up here.
      </div>

      <div
        v-for="op in operations"
        :key="op.id"
        class="ops-row"
        :class="`is-${op.status}`"
      >
        <span class="ops-status" :title="op.status">
          <span v-if="op.status === 'running'" class="ops-spin"></span>
          <BaseIcon v-else-if="op.status === 'succeeded'" name="check" :size="14" />
          <BaseIcon v-else name="close" :size="14" />
        </span>

        <BaseIcon class="ops-type" :name="typeIcon(op)" :size="15" />

        <span class="ops-main">
          <span class="ops-label">{{ op.label }}</span>
          <span class="ops-sub" v-if="op.connName">{{ op.connName }}</span>
        </span>

        <span class="ops-detail" :class="{ err: op.status === 'failed' }">{{ op.detail }}</span>
        <span class="ops-started">{{ startedText(op) }}</span>
        <span class="ops-duration">{{ durationText(op) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ops {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
}

.ops-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border-soft);
  flex: 0 0 auto;
}
.ops-title { font-size: 12px; font-weight: 600; color: var(--text); }
.ops-count {
  font-size: 10.5px;
  color: var(--text-dim);
  background: var(--bg-hover);
  border-radius: 9px;
  padding: 1px 7px;
}
.ops-spacer { flex: 1; }

.ops-body { flex: 1; min-height: 0; overflow-y: auto; }
.ops-empty { padding: 18px 12px; font-size: 12px; color: var(--text-faint); text-align: center; }

.ops-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-soft);
  font-size: 12px;
}
.ops-row:nth-child(even) { background: var(--bg-row-alt); }

.ops-status { flex: 0 0 16px; display: inline-flex; align-items: center; justify-content: center; }
.ops-row.is-succeeded .ops-status { color: var(--green); }
.ops-row.is-failed .ops-status { color: var(--danger); }

.ops-type { flex: 0 0 auto; color: var(--text-dim); }

.ops-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.ops-label { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ops-sub { font-size: 10.5px; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.ops-detail {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 34%;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}
.ops-detail.err { color: var(--danger-text); }

.ops-started { flex: 0 0 auto; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.ops-duration { flex: 0 0 62px; text-align: right; color: var(--text-dim); font-variant-numeric: tabular-nums; }

.ops-spin {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  border-top-color: var(--accent);
  animation: ops-spin 0.7s linear infinite;
}
@keyframes ops-spin { to { transform: rotate(360deg); } }
</style>
