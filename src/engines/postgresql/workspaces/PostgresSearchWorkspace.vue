<script setup>
// Cross-table "Search in…" for a PostgreSQL schema, as a tab (#180): a substring or
// regex match across every text-like column of the schema's tables, or an explicit
// subset. The search and its result live on the tab (searchRun.js), so they survive
// switching away to look at a match and back.
import { computed } from 'vue'
import { runSearch, cancelSearch } from './searchRun.js'
import { openPostgresTable } from '../../../stores/tabCreators'
import { crumbSegments } from '../../../utils/crumbSegments'
import WorkspaceCrumbs from '../../../components/base/WorkspaceCrumbs.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseCheckbox from '../../../components/base/BaseCheckbox.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import HintText from '../../../components/base/HintText.vue'

const props = defineProps({
  activeTab: { type: Object, required: true },
})

const items = computed(() => crumbSegments({ connection: props.activeTab.connectionName, target: props.activeTab.target }))
const state = computed(() => props.activeTab.state)
const run = computed(() => props.activeTab.runtime)

// A match opens its row in a new table tab, filtered by its primary key (#172).
function openMatch(m) {
  const { connectionId, connectionName, database, schema } = props.activeTab
  openPostgresTable({ connectionId, connectionName, database, schema, table: m.table, rowKey: m.primaryKey })
}

function keyText(pk) {
  return Object.entries(pk).map(([k, v]) => `${k} = ${v}`).join(', ')
}
</script>

<template>
  <div class="pg-search">
    <WorkspaceCrumbs engine="postgresql" :items="items" />
    <div class="ps-body">
      <div class="ps-controls">
        <BaseInput v-model="state.term" placeholder="Search for…" class="ps-term" @keydown.enter="runSearch(activeTab)" />
        <BaseButton v-if="!run.loading" bordered :disabled="!state.term.trim()" @click="runSearch(activeTab)">Search</BaseButton>
        <BaseButton v-else bordered @click="cancelSearch(activeTab)">Cancel</BaseButton>
      </div>
      <div class="ps-controls">
        <BaseInput v-model="state.tables" placeholder="Tables (comma-separated; blank = every table in this schema)" class="ps-tables" />
        <BaseCheckbox v-model="state.matchCase" label="Match case" />
        <BaseCheckbox v-model="state.regex" label="Regex" />
      </div>

      <StateMessage v-if="run.loading" mode="loading" label="Searching…" />
      <StateMessage v-else-if="run.error" mode="error" :message="run.error" :code="run.errorCode" />
      <StateMessage v-else-if="run.result && !run.result.matches.length" mode="empty" label="No matches" />
      <template v-else-if="run.result">
        <HintText dim>
          {{ run.result.matches.length }} match{{ run.result.matches.length === 1 ? '' : 'es' }}
          <span v-if="run.result.truncated">(more exist; narrow the search or the table list)</span>
          <span v-if="run.result.skipped.length">· skipped (no primary key or no text column): {{ run.result.skipped.join(', ') }}</span>
        </HintText>
        <div class="ps-list">
          <div
            v-for="(m, i) in run.result.matches" :key="i" class="ps-item" role="button" tabindex="0"
            title="Open this row in a table tab" @click="openMatch(m)" @keydown.enter="openMatch(m)"
          >
            <code class="ps-loc">{{ m.table }}.{{ m.column }}</code>
            <span class="ps-value" :title="m.value">{{ m.value }}</span>
            <span class="ps-key">{{ keyText(m.primaryKey) }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pg-search { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; background: var(--bg-window); }
.ps-body { display: flex; flex-direction: column; gap: 12px; flex: 1; min-height: 0; padding: 14px 16px 16px; }
.ps-controls { flex: none; display: flex; align-items: center; gap: 10px; }
.ps-term, .ps-tables { flex: 1; }
.ps-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.ps-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px; border: 1px solid var(--border-soft); border-radius: 7px;
  background: var(--bg-field); cursor: pointer;
}
.ps-item:hover, .ps-item:focus-visible { background: var(--bg-hover); outline: none; }
.ps-loc { flex: none; font-family: var(--mono); font-size: 12px; color: var(--text-dim); }
.ps-value { flex: 1; min-width: 0; font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-key { flex: none; font-size: 11px; color: var(--text-faint); }
</style>
