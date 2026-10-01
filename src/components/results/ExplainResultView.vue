<script setup>
import { computed, ref } from 'vue'
import ExplainGraph from './ExplainGraph.vue'
import JsonDoc from './JsonDoc.vue'
import BaseSelect from '../base/BaseSelect.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import FieldError from '../base/FieldError.vue'
import { buildExplainTree } from '../../utils/explainTree'
import FlexSpacer from '../base/FlexSpacer.vue'

const VERBOSITY_OPTIONS = [
  { value: 'executionStats',    label: 'Execution stats' },
  { value: 'queryPlanner',      label: 'Query planner' },
  { value: 'allPlansExecution', label: 'All plans' },
]

// Explain sub-tab: the query's execution plan, shown either as a stage graph or the raw
// plan document. Parsing lives in buildExplainTree; ExplainGraph only draws the tree.
const props = defineProps({
  activeTab: { type: Object, required: true },
})

const emit = defineEmits(['explain-verbosity'])

// The explain document normalized into a render-ready node-graph tree (Result root +
// stage tree).
const explainTree = computed(() =>
  buildExplainTree(
    props.activeTab && props.activeTab.explainResult,
    props.activeTab && props.activeTab.explainStorage,
  )
)

// Sub-tab view mode: 'graph' (default) or 'json' (the raw plan document).
const explainView = ref('graph')
</script>

<template>
  <div class="explain-view">
    <div v-if="activeTab.explainRunning" class="explain-msg">Running explain…</div>
    <FieldError v-else-if="activeTab.explainError" :text="activeTab.explainError" class="run-error" />
    <template v-else-if="activeTab.explainResult">
      <div class="explain-toolbar">
        <SegmentedControl
          :model-value="explainView"
          :options="[{ value: 'graph', label: 'Graph' }, { value: 'json', label: 'View JSON' }]"
          @update:model-value="explainView = $event"
        />
        <FlexSpacer />
        <label class="et-verbosity">
          <span class="et-verbosity-label">Detail</span>
          <BaseSelect
            class="et-select"
            :model-value="activeTab.explainVerbosity || 'executionStats'"
            :options="VERBOSITY_OPTIONS"
            size="sm"
            @update:model-value="v => emit('explain-verbosity', v)"
          />
        </label>
      </div>
      <ExplainGraph v-if="explainView === 'graph'" :tree="explainTree" />
      <JsonDoc v-else class="json-doc" :value="activeTab.explainResult" />
    </template>
    <div v-else class="explain-msg">Run a query, then this tab shows its execution plan.</div>
  </div>
</template>

<style scoped>
.explain-view { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.explain-view > .json-doc { flex: 1; overflow: auto; padding: 12px 16px; }
.explain-msg { padding: 32px; color: var(--text-faint); font-size: 12px; display: flex; align-items: center; justify-content: center; }
.run-error { padding: 10px 14px; }

/* Graph / View JSON toggle + verbosity select */
.explain-toolbar { display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-soft); flex: 0 0 auto; }
.et-verbosity { display: inline-flex; align-items: center; gap: 7px; }
.et-verbosity-label { font-size: 11px; color: var(--text-dim); }
.et-select { min-width: 140px; }
</style>
