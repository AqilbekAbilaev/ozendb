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
import { resultColumns } from './resultColumns.js'
import { runSql, cancelSql, explainSql, formatSql, outcome, endTransaction } from './runSql.js'
import { showToast } from '../../../stores/toast'
import PostgresPlan from './PostgresPlan.vue'
import PostgresQueryLibrary from './PostgresQueryLibrary.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'
import { openModal } from '../../../stores/modals'

// A SQL editor with its toolbar, results and status line. `sql` is the editor's text
// (v-model:sql — the tab's lasting state); `run` is its runs (createSqlRun), written in
// place. `server` (`{ version, encoding }`) fills the status line when known. The
// default slot is a line above the toolbar; `toolbar-start` goes at the toolbar's left
// edge (the table tab's Filter / SQL switch).
const props = defineProps({
  sql:    { type: String, required: true },
  run:    { type: Object, required: true },
  server: { type: Object, default: null },
})
const emit = defineEmits(['update:sql'])
const setSql = (text) => emit('update:sql', text)
const exportQuery = () => openModal('pgExport', { connId: props.run.connectionId, database: props.run.database, query: props.sql })

// Manual: runs go into one transaction, begun by the first of them, until Commit or
// Rollback. The switch holds still while one is open.
const txnOptions = computed(() => {
  const title = props.run.txId ? 'Commit or roll back first' : undefined
  return [
    { value: 'auto', label: 'Auto-commit', disabled: !!props.run.txId, title },
    { value: 'manual', label: 'Manual', disabled: !!props.run.txId, title },
  ]
})

const columns = computed(() => props.run.result && resultColumns(props.run.result.columns))

const editor = ref(null)
const editorHeight = ref(180)
const rtab = ref('Result')
const cursor = ref({ line: 1, col: 1 })
const library = ref(null)   // which view of the query library is open, if any

function execute(sql = props.sql) {
  rtab.value = 'Result'
  return runSql(props.run, sql)
}

function explain() {
  rtab.value = 'Explain'
  return explainSql(props.run, props.sql)
}

async function format() {
  const { sql, reason } = await formatSql(props.sql)
  if (reason) showToast(reason)
  else setSql(sql)
}

function runSelection() {
  const { state } = editor.value.getView()
  const { from, to } = state.selection.main
  return execute(from === to ? undefined : state.sliceDoc(from, to))
}

// Mod-Enter runs the query; high precedence so the editor's own newline binding
// doesn't take it first.
const editorExtensions = [
  Prec.high(keymap.of([{ key: 'Mod-Enter', run: () => { execute(); return true } }])),
  EditorView.updateListener.of((update) => {
    if (!update.selectionSet) return
    const head = update.state.selection.main.head
    const line = update.state.doc.lineAt(head)
    cursor.value = { line: line.number, col: head - line.from + 1 }
  }),
]

const rtabs = computed(() => [
  { value: 'Result', label: 'Result', count: props.run.result?.rows.length },
  { value: 'Messages', label: 'Messages', count: props.run.messages.length },
  { value: 'Explain', label: 'Explain' },
])

const summary = computed(() => {
  const r = props.run.result
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
      <BaseButton variant="ghost" icon="run" class="run" :disabled="run.running || !sql.trim()" @click="execute()">
        {{ run.running ? 'Running…' : 'Run' }} <span class="kbd">⌘↵</span>
      </BaseButton>
      <BaseButton variant="ghost" icon="run" :disabled="run.running" title="Run the selected text" @click="runSelection">Run selection</BaseButton>
      <BaseButton variant="ghost" icon="exScan" :disabled="run.explaining || !sql.trim()" title="Show how PostgreSQL runs this query" @click="explain">Explain</BaseButton>
      <BaseButton variant="ghost" icon="close" :disabled="!run.running" title="Stop the running query" @click="cancelSql(run)">Cancel</BaseButton>
      <span class="qsep"></span>
      <BaseButton variant="ghost" icon="textType" class="qbar-hide-sm" :disabled="run.running || !sql.trim()" title="Lay the SQL out one clause per line" @click="format">Format</BaseButton>
      <BaseButton variant="ghost" icon="export" class="qbar-hide-sm" :disabled="!sql.trim()" title="Export every row this query returns" @click="exportQuery" />
      <BaseButton variant="ghost" icon="history" class="qbar-hide-sm" title="Queries run on this connection" @click="library = 'history'" />
      <BaseButton variant="ghost" icon="save" class="qbar-hide-sm" title="Save or open a saved query" @click="library = 'saved'" />
      <span class="qsep"></span>
      <SegmentedControl :model-value="run.txn ?? 'auto'" :options="txnOptions" variant="subtle" @update:model-value="run.txn = $event" />
      <template v-if="run.txn === 'manual'">
        <BaseButton variant="ghost" icon="check" :disabled="!run.txId || run.running" title="Make this transaction's changes permanent" @click="endTransaction(run, true)">Commit</BaseButton>
        <BaseButton variant="ghost" icon="undo" :disabled="!run.txId || run.running" title="Undo everything since the transaction began" @click="endTransaction(run, false)">Rollback</BaseButton>
      </template>
    </div>

    <CodeEditor
      ref="editor"
      :model-value="sql"
      @update:model-value="setSql"
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
      <PostgresMessages v-if="rtab === 'Messages'" :messages="run.messages" />
      <PostgresPlan v-else-if="rtab === 'Explain'" :plan="run.plan ?? null" :error="run.planError ?? null" :explaining="!!run.explaining" />
      <StateMessage v-else-if="run.error" mode="error" :message="run.error" />
      <StateMessage v-else-if="run.running && !run.result" mode="loading" />
      <template v-else-if="run.result">
        <StateMessage v-if="run.result.rowsAffected != null" mode="empty" :label="outcome(run.result)" />
        <StateMessage v-else-if="!run.result.rows.length" mode="empty" label="The query returned no rows" />
        <PostgresResultGrid v-else :columns="columns.keys" :column-info="columns.info" :rows="run.result.rows" :selection="run.selection" />
      </template>
      <StateMessage v-else mode="empty" label="Run a query to see its results (⌘↵)" />
    </div>

    <PostgresQueryLibrary
      v-if="library"
      :connection-id="run.connectionId"
      :sql="sql"
      :view="library"
      @load="setSql"
      @close="library = null"
    />

    <div class="pg-footer">
      <span>{{ summary }}</span>
      <span v-if="run.result" class="fitem"><BaseIcon name="clock" :size="14" /> {{ run.result.elapsedMs }} ms</span>
      <span v-if="run.txId" class="fitem txn-open">● Transaction open</span>
      <span v-else>{{ run.txn === 'manual' ? 'Manual' : 'Auto-commit' }}</span>
      <FlexSpacer />
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
</style>
<style scoped src="../../../components/workspace/WorkspaceToolbar.css"></style>
