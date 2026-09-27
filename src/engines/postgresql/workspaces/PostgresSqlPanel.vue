<script setup>
import { ref, computed } from 'vue'
import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import CodeEditor from '../../../components/base/CodeEditor.vue'
import Resizer from '../../../components/base/Resizer.vue'
import SegmentedControl from '../../../components/base/SegmentedControl.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import TabStrip from '../../../components/base/TabStrip.vue'
import PostgresMessages from './PostgresMessages.vue'
import PostgresResultGrid from './PostgresResultGrid.vue'
import { runSql } from './runSql.js'

// A SQL editor with its toolbar, results and status line. `state` holds
// `{ connectionId, sql, result, error, running, messages? }` and is written in place —
// a query tab passes itself. `server` (`{ version, encoding }`) fills the status line
// when known. The default slot is a line above the toolbar.
const props = defineProps({
  state:  { type: Object, required: true },
  server: { type: Object, default: null },
})

const SOON = 'Coming soon'
const TXN = [{ value: 'auto', label: 'Auto-commit' }, { value: 'manual', label: 'Manual', disabled: true, title: SOON }]

const editor = ref(null)
const editorHeight = ref(180)
const rtab = ref('Result')
const cursor = ref({ line: 1, col: 1 })

function run(sql) {
  rtab.value = 'Result'
  return runSql(props.state, sql)
}

function runSelection() {
  const { state } = editor.value.getView()
  const { from, to } = state.selection.main
  return run(from === to ? undefined : state.sliceDoc(from, to))
}

// Mod-Enter runs the query; high precedence so the editor's own newline binding
// doesn't take it first.
const editorExtensions = [
  Prec.high(keymap.of([{ key: 'Mod-Enter', run: () => { run(); return true } }])),
  EditorView.updateListener.of((update) => {
    if (!update.selectionSet) return
    const head = update.state.selection.main.head
    const line = update.state.doc.lineAt(head)
    cursor.value = { line: line.number, col: head - line.from + 1 }
  }),
]

const rtabs = computed(() => [
  { value: 'Result', label: 'Result', count: props.state.result?.rows.length },
  { value: 'Messages', label: 'Messages', count: props.state.messages?.length },
  { value: 'Explain', label: 'Explain', disabled: true, title: SOON },
])

const summary = computed(() => {
  const r = props.state.result
  if (!r) return 'No results'
  const rows = `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}`
  return r.truncated ? `${rows} (first rows only — the result was capped)` : rows
})
</script>

<template>
  <div class="pg-sql">
    <slot />
    <div class="qbar">
      <BaseButton variant="ghost" icon="run" class="run" :disabled="state.running || !state.sql.trim()" @click="run()">
        {{ state.running ? 'Running…' : 'Run' }} <span class="kbd">⌘↵</span>
      </BaseButton>
      <BaseButton variant="ghost" icon="run" :disabled="state.running" title="Run the selected text" @click="runSelection">Run selection</BaseButton>
      <BaseButton variant="ghost" icon="exScan" disabled :title="SOON">Explain</BaseButton>
      <BaseButton variant="ghost" icon="close" disabled :title="SOON">Cancel</BaseButton>
      <span class="qsep"></span>
      <BaseButton variant="ghost" icon="textType" class="qbar-hide-sm" disabled :title="SOON">Format</BaseButton>
      <BaseButton variant="ghost" icon="history" class="qbar-hide-sm" disabled :title="SOON" />
      <BaseButton variant="ghost" icon="save" class="qbar-hide-sm" disabled :title="SOON" />
      <span class="qsep"></span>
      <SegmentedControl model-value="auto" :options="TXN" variant="subtle" />
    </div>

    <CodeEditor
      ref="editor"
      v-model="state.sql"
      class="pg-editor"
      :style="{ height: editorHeight + 'px' }"
      language="sql"
      :extensions="editorExtensions"
    />
    <Resizer v-model="editorHeight" axis="y" :min="80" :max="520" />

    <div class="rtabs">
      <TabStrip v-model="rtab" :options="rtabs" />
    </div>
    <div class="pg-results">
      <PostgresMessages v-if="rtab === 'Messages'" :messages="state.messages ?? []" />
      <StateMessage v-else-if="state.error" mode="error" :message="state.error" />
      <StateMessage v-else-if="state.running && !state.result" mode="loading" />
      <template v-else-if="state.result">
        <StateMessage v-if="!state.result.rows.length" mode="empty" label="The query returned no rows" />
        <PostgresResultGrid v-else :columns="state.result.columns" :rows="state.result.rows" />
      </template>
      <StateMessage v-else mode="empty" label="Run a query to see its results (⌘↵)" />
    </div>

    <div class="pg-footer">
      <span>{{ summary }}</span>
      <span v-if="state.result" class="fitem"><BaseIcon name="clock" :size="14" /> {{ state.result.elapsedMs }} ms</span>
      <span>Auto-commit</span>
      <span class="spacer"></span>
      <span>Ln {{ cursor.line }}, Col {{ cursor.col }}</span>
      <template v-if="server">
        <span>{{ server.encoding }}</span>
        <span>PostgreSQL {{ server.version }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pg-sql { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.pg-editor { flex: none; }
.rtabs { display: flex; flex: none; border-bottom: 1px solid var(--border); }
.pg-results { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.pg-footer {
  display: flex; align-items: center; gap: 16px; flex: none;
  padding: 4px 12px; font-size: 12px; color: var(--text-dim);
  border-top: 1px solid var(--border); background: var(--bg-panel);
}
.fitem { display: flex; align-items: center; gap: 6px; }
.spacer { flex: 1; }
</style>
<style scoped src="../../../components/workspace/WorkspaceToolbar.css"></style>
