<script setup>
import { computed } from 'vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import { planRows } from './planRows.js'

// The Explain tab: the query plan as an indented list, each node's time as a bar
// against the whole query's, the slowest step marked. `plan` is the backend's
// EXPLAIN (ANALYZE, FORMAT JSON) array.
const props = defineProps({
  plan:       { type: Array,   default: null },
  error:      { type: String,  default: null },
  explaining: { type: Boolean, default: false },
})

const view = computed(() => (props.plan ? planRows(props.plan) : null))
const ms = (value) => (value < 10 ? value.toFixed(3) : value.toFixed(1))
</script>

<template>
  <StateMessage v-if="error" mode="error" :message="error" />
  <StateMessage v-else-if="explaining" mode="loading" />
  <StateMessage v-else-if="!view" mode="empty" label="Press Explain to see how PostgreSQL runs this query" />
  <div v-else class="plan">
    <div class="plan-row plan-head"><span>Step</span><span>Time</span><span>Rows</span><span>ms</span></div>
    <div v-for="(r, i) in view.rows" :key="i" class="plan-row">
      <span class="plan-node" :style="{ paddingLeft: r.depth * 18 + 'px' }">
        <b>{{ r.node }}</b><span v-if="r.detail">{{ r.detail }}</span>
      </span>
      <span class="plan-bar"><i :class="{ hot: r.hot }" :style="{ width: Math.max(r.share * 100, 1) + '%' }"></i></span>
      <span class="plan-num">{{ r.rows }}</span>
      <span class="plan-num">{{ ms(r.ms) }}</span>
    </div>
    <div class="plan-foot">Planning {{ ms(view.planningMs) }} ms · Execution {{ ms(view.executionMs) }} ms</div>
  </div>
</template>

<style scoped>
.plan { flex: 1; overflow: auto; }
.plan-row {
  display: grid; grid-template-columns: minmax(0, 1fr) 180px 70px 80px; align-items: center; gap: 14px;
  padding: 6px 14px; font-size: 12.5px; border-bottom: 1px solid var(--grid-line);
}
.plan-head {
  color: var(--text-faint); font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
  background: var(--bg-panel-2); border-bottom: 1px solid var(--border);
}
.plan-node { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.plan-node b { font-weight: 600; color: var(--text); white-space: nowrap; }
.plan-node span { color: var(--text-faint); font: 11.5px var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-bar { height: 6px; border-radius: 3px; background: var(--bg-active); overflow: hidden; }
.plan-bar i { display: block; height: 100%; background: var(--accent); }
.plan-bar i.hot { background: var(--warn); }
.plan-num { text-align: right; font: 11.5px var(--mono); color: var(--text-dim); }
.plan-foot { padding: 10px 14px; font: 11.5px var(--mono); color: var(--text-faint); }
</style>
