<script setup>
import { computed } from 'vue'
import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import CodeEditor from '../../../components/base/CodeEditor.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import PostgresResultGrid from './PostgresResultGrid.vue'
import { runSql } from './runSql.js'

const props = defineProps({
  activeTab: { type: Object, required: true },
})

const run = () => runSql(props.activeTab)

// Mod-Enter runs the query; high precedence so the editor's own newline binding
// doesn't take it first.
const editorKeys = [Prec.high(keymap.of([{ key: 'Mod-Enter', run: () => { run(); return true } }]))]

const summary = computed(() => {
  const r = props.activeTab.result
  if (!r) return ''
  const rows = `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}`
  const capped = r.truncated ? ' (first rows only — the result was capped)' : ''
  return `${rows}${capped} · ${r.elapsedMs} ms`
})
</script>

<template>
  <div class="pg-query">
    <div class="pg-bar">
      <span class="pg-name">{{ activeTab.connectionName }} · {{ activeTab.database }}</span>
      <span class="spacer"></span>
      <BaseButton variant="primary" :disabled="activeTab.running || !activeTab.sql.trim()" @click="run">
        <BaseIcon name="run" :size="14" /> {{ activeTab.running ? 'Running…' : 'Run' }}
      </BaseButton>
    </div>

    <CodeEditor
      v-model="activeTab.sql"
      class="pg-editor"
      language="sql"
      :extensions="editorKeys"
    />

    <div class="pg-results">
      <StateMessage v-if="activeTab.error" mode="error" :message="activeTab.error" />
      <StateMessage v-else-if="activeTab.running && !activeTab.result" mode="loading" />
      <template v-else-if="activeTab.result">
        <div class="pg-summary">{{ summary }}</div>
        <StateMessage v-if="!activeTab.result.columns.length" mode="empty" label="The query returned no rows" />
        <PostgresResultGrid v-else :columns="activeTab.result.columns" :rows="activeTab.result.rows" />
      </template>
      <StateMessage v-else mode="empty" label="Run a query to see its results" />
    </div>
  </div>
</template>

<style scoped>
.pg-query { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.pg-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-bottom: 1px solid var(--border);
  background: var(--bg-toolbar);
}
.pg-name { font-weight: 600; color: var(--text); }
.spacer { flex: 1; }
.pg-editor { height: 180px; flex: none; border-bottom: 1px solid var(--border); }
.pg-results { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.pg-summary { padding: 5px 10px; font-size: 12px; color: var(--text-dim); }
</style>
