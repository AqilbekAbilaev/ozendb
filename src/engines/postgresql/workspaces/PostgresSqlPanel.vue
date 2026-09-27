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

// A SQL editor with its Run button and results. `state` holds `{ connectionId, sql,
// result, error, running }` and is written in place — a query tab passes itself.
// The default slot fills the left of the Run bar.
const props = defineProps({
  state: { type: Object, required: true },
})

const run = () => runSql(props.state)

// Mod-Enter runs the query; high precedence so the editor's own newline binding
// doesn't take it first.
const editorKeys = [Prec.high(keymap.of([{ key: 'Mod-Enter', run: () => { run(); return true } }]))]

const summary = computed(() => {
  const r = props.state.result
  if (!r) return ''
  const rows = `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}`
  const capped = r.truncated ? ' (first rows only — the result was capped)' : ''
  return `${rows}${capped} · ${r.elapsedMs} ms`
})
</script>

<template>
  <div class="pg-sql">
    <div class="pg-bar">
      <slot />
      <span class="spacer"></span>
      <BaseButton variant="primary" :disabled="state.running || !state.sql.trim()" @click="run">
        <BaseIcon name="run" :size="14" /> {{ state.running ? 'Running…' : 'Run' }}
      </BaseButton>
    </div>

    <CodeEditor
      v-model="state.sql"
      class="pg-editor"
      language="sql"
      :extensions="editorKeys"
    />

    <div class="pg-results">
      <StateMessage v-if="state.error" mode="error" :message="state.error" />
      <StateMessage v-else-if="state.running && !state.result" mode="loading" />
      <template v-else-if="state.result">
        <div class="pg-summary">{{ summary }}</div>
        <StateMessage v-if="!state.result.rows.length" mode="empty" label="The query returned no rows" />
        <PostgresResultGrid v-else :columns="state.result.columns" :rows="state.result.rows" />
      </template>
      <StateMessage v-else mode="empty" label="Run a query to see its results" />
    </div>
  </div>
</template>

<style scoped>
.pg-sql { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.pg-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-bottom: 1px solid var(--border);
  background: var(--bg-toolbar);
}
.spacer { flex: 1; }
.pg-editor { height: 180px; flex: none; border-bottom: 1px solid var(--border); }
.pg-results { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.pg-summary { padding: 5px 10px; font-size: 12px; color: var(--text-dim); }
</style>
