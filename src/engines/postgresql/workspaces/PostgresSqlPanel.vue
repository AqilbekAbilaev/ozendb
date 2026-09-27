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
import { runSql, cancelSql, explainSql, formatSql, outcome, endTransaction } from './runSql.js'
import { showToast } from '../../../stores/toast'
import PostgresPlan from './PostgresPlan.vue'
import PostgresQueryLibrary from './PostgresQueryLibrary.vue'

// A SQL editor with its toolbar, results and status line. `state` holds
// `{ connectionId, sql, result, error, running, messages? }` and is written in place —
// a query tab passes itself. `server` (`{ version, encoding }`) fills the status line
// when known. The default slot is a line above the toolbar; `toolbar-start` goes at
// the toolbar's left edge (the table tab's Filter / SQL switch).
const props = defineProps({
  state:  { type: Object, required: true },
  server: { type: Object, default: null },
})

// Manual: runs go into one transaction, begun by the first of them, until Commit or
// Rollback. The switch holds still while one is open.
const txnOptions = computed(() => {
  const title = props.state.txId ? 'Commit or roll back first' : undefined
  return [
    { value: 'auto', label: 'Auto-commit', disabled: !!props.state.txId, title },
    { value: 'manual', label: 'Manual', disabled: !!props.state.txId, title },
  ]
})

const editor = ref(null)
const editorHeight = ref(180)
const rtab = ref('Result')
const cursor = ref({ line: 1, col: 1 })
const library = ref(null)   // which view of the query library is open, if any

function run(sql) {
  rtab.value = 'Result'
  return runSql(props.state, sql)
}

function explain() {
  rtab.value = 'Explain'
  return explainSql(props.state)
}

async function format() {
  const reason = await formatSql(props.state)
  if (reason) showToast(reason)
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
  { value: 'Explain', label: 'Explain' },
])

const summary = computed(() => {
  const r = props.state.result
  if (!r) return 'No results'
  if (r.rowsAffected != null) return outcome(r)
  const rows = `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}`
  return r.truncated ? `${rows} (first rows only — the result was capped)` : rows
})
</script>

<template>
  <div class="pg-sql">
    <slot />
    <div class="qbar">
      <slot name="toolbar-start" />
      <BaseButton variant="ghost" icon="run" class="run" :disabled="state.running || !state.sql.trim()" @click="run()">
        {{ state.running ? 'Running…' : 'Run' }} <span class="kbd">⌘↵</span>
      </BaseButton>
      <BaseButton variant="ghost" icon="run" :disabled="state.running" title="Run the selected text" @click="runSelection">Run selection</BaseButton>
      <BaseButton variant="ghost" icon="exScan" :disabled="state.explaining || !state.sql.trim()" title="Show how PostgreSQL runs this query" @click="explain">Explain</BaseButton>
      <BaseButton variant="ghost" icon="close" :disabled="!state.running" title="Stop the running query" @click="cancelSql(state)">Cancel</BaseButton>
      <span class="qsep"></span>
      <BaseButton variant="ghost" icon="textType" class="qbar-hide-sm" :disabled="state.running || !state.sql.trim()" title="Lay the SQL out one clause per line" @click="format">Format</BaseButton>
      <BaseButton variant="ghost" icon="history" class="qbar-hide-sm" title="Queries run on this connection" @click="library = 'history'" />
      <BaseButton variant="ghost" icon="save" class="qbar-hide-sm" title="Save or open a saved query" @click="library = 'saved'" />
      <span class="qsep"></span>
      <SegmentedControl :model-value="state.txn ?? 'auto'" :options="txnOptions" variant="subtle" @update:model-value="state.txn = $event" />
      <template v-if="state.txn === 'manual'">
        <BaseButton variant="ghost" icon="check" :disabled="!state.txId || state.running" title="Make this transaction's changes permanent" @click="endTransaction(state, true)">Commit</BaseButton>
        <BaseButton variant="ghost" icon="undo" :disabled="!state.txId || state.running" title="Undo everything since the transaction began" @click="endTransaction(state, false)">Rollback</BaseButton>
      </template>
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
      <PostgresPlan v-else-if="rtab === 'Explain'" :plan="state.plan ?? null" :error="state.planError ?? null" :explaining="!!state.explaining" />
      <StateMessage v-else-if="state.error" mode="error" :message="state.error" />
      <StateMessage v-else-if="state.running && !state.result" mode="loading" />
      <template v-else-if="state.result">
        <StateMessage v-if="state.result.rowsAffected != null" mode="empty" :label="outcome(state.result)" />
        <StateMessage v-else-if="!state.result.rows.length" mode="empty" label="The query returned no rows" />
        <PostgresResultGrid v-else :columns="state.result.columns" :rows="state.result.rows" />
      </template>
      <StateMessage v-else mode="empty" label="Run a query to see its results (⌘↵)" />
    </div>

    <PostgresQueryLibrary
      v-if="library"
      :connection-id="state.connectionId"
      :sql="state.sql"
      :view="library"
      @load="sql => state.sql = sql"
      @close="library = null"
    />

    <div class="pg-footer">
      <span>{{ summary }}</span>
      <span v-if="state.result" class="fitem"><BaseIcon name="clock" :size="14" /> {{ state.result.elapsedMs }} ms</span>
      <span v-if="state.txId" class="fitem txn-open">● Transaction open</span>
      <span v-else>{{ state.txn === 'manual' ? 'Manual' : 'Auto-commit' }}</span>
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
.txn-open { color: var(--warn); }
.spacer { flex: 1; }
</style>
<style scoped src="../../../components/workspace/WorkspaceToolbar.css"></style>
