<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listDatabases } from '../../engines/mongodb/api/resources'
import { runShellCommand, getShellHistory, pushShellCommand, clearShellHistory } from '../../engines/mongodb/api/shell'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { errText } from '../../utils/errors'
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'
import TabStrip from '../base/TabStrip.vue'
import CollectionCrumbs from '../base/CollectionCrumbs.vue'
import ResultTable from '../results/ResultTable.vue'
import TreeView from '../base/TreeView.vue'
import { mongoStringify, syntaxHighlight } from '../../utils/mongoFormat'
import CodeEditor from '../base/CodeEditor.vue'
import { shellExtensions } from '../../utils/shellEditor'

// IntelliShell, Studio-3T style: a code editor on top, the command's output in
// the reused result grid (Table / JSON / Tree) below, plus a Console tab for
// print() output, scalar results, and errors. Bound to a shell tab (connection
// + database) with its own backend JS session (tab.sessionId).
const props = defineProps({
  activeTab: { type: Object, required: true },
})

const historyMenu = ref(false)
const drillPath = computed({
  get: () => props.activeTab.drillPath || [],
  set: (val) => { props.activeTab.drillPath = val },
})

const VIEWS = [['table', 'Table View'], ['json', 'JSON View'], ['tree', 'Tree View']]
const viewMenu = ref(false)
const viewLabel = computed(() => {
  const found = VIEWS.find(([k]) => k === props.activeTab.resultView)
  return found ? found[1] : 'Table View'
})

const resultCount = computed(() => props.activeTab.results?.length ?? 0)

// ── CodeMirror editor ──────────────────────────────────
const editorRef = ref(null)         // the CodeEditor component instance
const dbCollections = ref([])       // collection names for `db.` autocomplete
// Stable shell extensions: run keymaps + Mongo autocomplete (the completion source reads
// dbCollections live through the getter, so this never needs rebuilding). The buffer syncs
// to the tab through CodeEditor's v-model; switching tabs swaps it automatically.
const shellExt = shellExtensions({
  onRun:     () => run(),
  onRunLine: (line) => run(line),
  getCollections: () => dbCollections.value,
})

// Best-effort: preload this database's collection names for `db.` completion.
async function loadCollections() {
  try {
    const dbs = await listDatabases(props.activeTab.connectionId)
    const match = Array.isArray(dbs) ? dbs.find(d => d.name === props.activeTab.dbName) : null
    if (match && Array.isArray(match.collections)) dbCollections.value = match.collections
  } catch (_) {}
}

onMounted(async () => {
  loadCollections()
  // Load this connection's persisted command history so the History dropdown
  // (and recall) spans previous sessions.
  try {
    const past = await getShellHistory(props.activeTab.connectionId)
    if (Array.isArray(past)) props.activeTab.history = past
  } catch (_) {}
})

// One ShellConsole instance is reused across shell tabs — the editor buffer follows the
// bound tab via v-model; just reload this tab's completions.
watch(() => props.activeTab.id, () => {
  dbCollections.value = []
  loadCollections()
})

async function run(codeOverride) {
  const tab = props.activeTab
  const code = (codeOverride ?? tab.code ?? '').trim()
  if (!code || tab.isRunning) return

  tab.isRunning = true
  tab.runError = null
  const t0 = Date.now()
  pushShellCommand(tab.connectionId, code).catch(() => {})
  if (!tab.history.includes(code)) tab.history.push(code)

  try {
    const res = await runShellCommand(
      { connectionId: tab.connectionId, database: tab.dbName, sessionId: tab.sessionId },
      code,
    )
    tab.elapsedMs = Date.now() - t0
    tab.logs = res.logs || []
    tab.selectedRow = -1
    tab.drillPath = []
    tab.hasRun = true   // ResultTable hides its grid until a run has happened

    if (res.error) {
      tab.runError = res.error
      tab.results = []
      tab.hasScalar = false
      tab.resultTab = 'Console'
    } else {
      tab.runError = null
      const value = res.value
      if (Array.isArray(value)) {
        tab.results = value
        tab.hasScalar = false
        // Objects → table; arrays of scalars → JSON reads better.
        const objects = value.length === 0 || value.every(v => v && typeof v === 'object' && !Array.isArray(v))
        tab.resultView = objects ? 'table' : 'json'
        tab.resultTab = 'Result'
      } else if (value !== null && value !== undefined && typeof value === 'object') {
        tab.results = [value]
        tab.hasScalar = false
        tab.resultView = 'table'
        tab.resultTab = 'Result'
      } else {
        // scalar or undefined → no grid; show it in the Console
        tab.results = []
        tab.scalar = value
        tab.hasScalar = value !== undefined
        tab.resultTab = 'Console'
      }
    }
  } catch (e) {
    tab.elapsedMs = Date.now() - t0
    tab.runError = errText(e)
    tab.results = []
    tab.hasScalar = false
    tab.resultTab = 'Console'
  } finally {
    tab.isRunning = false
  }
}

// Run just the line under the cursor (toolbar button; mirrors ⌘⇧⏎).
function runCurrentLine() {
  const view = editorRef.value?.getView()
  if (!view) return
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  run(line.text)
}

function openHistory() {
  if (historyMenu.value) { historyMenu.value = false; return }
  historyMenu.value = true
}
function applyHistory(cmd) {
  props.activeTab.code = cmd
  historyMenu.value = false
}
async function clearHistory() {
  const tab = props.activeTab
  if (!tab) return
  try {
    await clearShellHistory(tab.connectionId)
    tab.history = []
  } catch (_) {}
}

// ── Save / open shell scripts ──────────────────────────
// A shell tab isn't tied to a file; these let the user load a .js script into
// the editor or write the current editor contents out. `tab.scriptPath`
// remembers the last file so a re-save defaults to it.
async function openScript() {
  let path
  try {
    path = await openDialog({
      multiple: false,
      filters: [{ name: 'JavaScript', extensions: ['js'] }],
    })
  } catch (e) {
    reportScriptError('Open failed: ' + errText(e))
    return
  }
  if (!path) return  // user cancelled
  try {
    const text = await invoke('read_shell_script', { path: String(path) })
    props.activeTab.code = text
    props.activeTab.scriptPath = String(path)
  } catch (e) {
    reportScriptError('Open failed: ' + errText(e))
  }
}

async function saveScript() {
  const tab = props.activeTab
  // Prefer the editor's live text over tab.code in case a keystroke hasn't
  // flushed through v-model yet.
  const view = editorRef.value?.getView()
  const contents = view ? view.state.doc.toString() : (tab.code || '')
  let path
  try {
    path = await saveDialog({
      defaultPath: tab.scriptPath || 'script.js',
      filters: [{ name: 'JavaScript', extensions: ['js'] }],
    })
  } catch (e) {
    reportScriptError('Save failed: ' + errText(e))
    return
  }
  if (!path) return  // user cancelled
  try {
    await invoke('write_shell_script', { path: String(path), contents: contents })
    tab.scriptPath = String(path)
  } catch (e) {
    reportScriptError('Save failed: ' + errText(e))
  }
}

// Surface a file error in the Console tab, the shell's existing error channel.
function reportScriptError(message) {
  props.activeTab.runError = message
  props.activeTab.resultTab = 'Console'
}

function formatScalar(value) {
  if (value === undefined) return ''
  try {
    return syntaxHighlight(mongoStringify(value))
  } catch (_) {
    return String(value)
  }
}
</script>

<template>
  <div class="shell">
    <!-- Connection → database, same crumb bar the collection panes show -->
    <CollectionCrumbs :conn="activeTab.connectionName" :db="activeTab.dbName" />

    <!-- Toolbar -->
    <div class="shell-toolbar">
      <BaseButton variant="ghost" size="sm" class="run" @click="run()" :disabled="activeTab.isRunning">
        <BaseIcon name="run" :size="16" class="ic" /> Run <span class="kbd">⌘⏎</span>
      </BaseButton>
      <BaseButton variant="ghost" size="sm" @click="runCurrentLine" :disabled="activeTab.isRunning" title="Run the line under the cursor">
        <BaseIcon name="run" :size="16" class="ic" /> Run line <span class="kbd">⌘⇧⏎</span>
      </BaseButton>
      <div class="tb-sep"></div>
      <div class="hist-wrap">
        <BaseButton variant="ghost" size="sm" :active="historyMenu" @click="openHistory">
          <BaseIcon name="history" :size="16" class="ic" /> History
        </BaseButton>
        <div v-if="historyMenu" class="hist-backdrop" @mousedown.self="historyMenu = false"></div>
        <div v-if="historyMenu" class="hist-menu">
          <div class="hist-header">
            <span class="hist-title">Shell History</span>
            <BaseButton variant="ghost" size="sm" @click="clearHistory" :disabled="!activeTab.history.length">Clear</BaseButton>
          </div>
          <div v-if="!activeTab.history.length" class="hist-empty">No history yet.</div>
          <div
            v-for="(cmd, i) in [...activeTab.history].reverse()"
            :key="i"
            class="hist-item"
            @click="applyHistory(cmd)"
          >{{ cmd }}</div>
        </div>
      </div>
      <div class="tb-sep"></div>
      <BaseButton variant="ghost" size="sm" @click="openScript" title="Load a .js script into the editor">
        <BaseIcon name="folder" :size="16" class="ic" /> Open
      </BaseButton>
      <BaseButton variant="ghost" size="sm" @click="saveScript" title="Save the editor contents to a .js file">
        <BaseIcon name="save" :size="16" class="ic" /> Save
      </BaseButton>
      <span class="tb-spacer"></span>
    </div>

    <!-- Editor: CodeMirror (JS highlighting + Mongo autocomplete) -->
    <div class="shell-editor">
      <CodeEditor class="shell-cm" ref="editorRef" v-model="activeTab.code" :extensions="shellExt" />
    </div>

    <!-- Results -->
    <div class="shell-results">
      <div class="rtabs">
        <TabStrip
          :model-value="activeTab.resultTab"
          :options="[{ value: 'Result', label: 'Result' }, { value: 'Console', label: 'Console' }]"
          @update:model-value="activeTab.resultTab = $event"
        />

        <span class="rtabs-spacer"></span>

        <!-- view switch (Result only) -->
        <div v-if="activeTab.resultTab === 'Result'" class="view-select-wrap">
          <span class="view-select" @click="viewMenu = !viewMenu">
            {{ viewLabel }} <BaseIcon name="caretDown" :size="12" />
          </span>
          <div v-if="viewMenu" class="view-menu">
            <div
              v-for="[k, label] in VIEWS"
              :key="k"
              class="view-menu-item"
              :class="{ on: activeTab.resultView === k }"
              @click="activeTab.resultView = k; viewMenu = false"
            >
              <BaseIcon v-if="activeTab.resultView === k" name="check" :size="13" />
              <span>{{ label }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Result tab -->
      <template v-if="activeTab.resultTab === 'Result'">
        <ResultTable
          v-if="activeTab.resultView === 'table'"
          :active-tab="activeTab"
          :readonly="true"
          v-model:drillPath="drillPath"
        />
        <div v-else-if="activeTab.resultView === 'json'" class="json-view">
          <div v-if="!resultCount" class="empty">No documents</div>
          <div v-else class="json-doc" v-for="(doc, i) in activeTab.results" :key="i"
            v-html="syntaxHighlight(mongoStringify(doc))"></div>
        </div>
        <div v-else class="tree-view">
          <div v-if="!resultCount" class="empty">No documents</div>
          <template v-else>
            <div class="tree-head">
              <span class="th-key">Key</span><span class="th-val">Value</span><span class="th-type">Type</span>
            </div>
            <div class="tree-body">
              <TreeView v-for="(doc, i) in activeTab.results" :key="i" :label="`(${i + 1})`" :value="doc" :depth="0" />
            </div>
          </template>
        </div>
      </template>

      <!-- Console tab -->
      <div v-else class="console">
        <div v-if="activeTab.elapsedMs != null" class="out-meta">
          → {{ activeTab.runError ? 'error' : (resultCount ? `${resultCount} document${resultCount === 1 ? '' : 's'}` : 'ok') }}
          · {{ (activeTab.elapsedMs / 1000).toFixed(3) }}s
        </div>
        <pre v-for="(line, i) in activeTab.logs" :key="'l' + i" class="c-log">{{ line }}</pre>
        <pre v-if="activeTab.runError" class="c-err">{{ activeTab.runError }}</pre>
        <pre v-else-if="activeTab.hasScalar" class="c-val" v-html="formatScalar(activeTab.scalar)"></pre>
        <div v-if="!activeTab.logs.length && !activeTab.runError && !activeTab.hasScalar && activeTab.elapsedMs == null"
          class="empty">Type a command and press ⌘⏎ / Ctrl+⏎ to run.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg-window); }

/* toolbar (matches ui-design) */
.shell-toolbar {
  display: flex; align-items: center; gap: 2px;
  padding: 6px 10px; border-bottom: 1px solid var(--border);
  background: var(--bg-toolbar); flex: none;
}
.ic { color: var(--text-dim); }
.run .ic { color: var(--green); }
.kbd {
  font-size: 10.5px; color: var(--text-faint);
  border: 1px solid var(--border-soft); border-radius: 4px; padding: 1px 5px; margin-left: 4px;
}
.tb-sep { width: 1px; align-self: stretch; background: var(--border-soft); margin: 4px 6px; }
.tb-spacer { flex: 1; }

/* history dropdown (mirrors QueryBar) */
.hist-wrap { position: relative; }
.hist-backdrop { position: fixed; inset: 0; z-index: 40; }
.hist-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 41;
  width: 420px; max-height: 320px; overflow-y: auto;
  background: var(--bg-panel); border: 1px solid var(--border-soft);
  border-radius: 8px; padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,.4);
}
.hist-header {
  display: flex; align-items: center;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--border-soft);
}
.hist-title { font-size: 12px; font-weight: 600; color: var(--text-dim); flex: 1; }
.hist-empty { padding: 12px; color: var(--text-faint); font-size: 12px; }
.hist-item {
  padding: 7px 9px; border-radius: 5px; cursor: pointer;
  font-family: var(--mono); font-size: 12px; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hist-item:hover { background: var(--bg-hover); }

/* editor: CodeMirror host (matches ui-design dimensions) */
.shell-editor {
  flex: none; display: flex; height: 180px; min-height: 90px; max-height: 320px;
  resize: vertical; overflow: hidden;
  border-bottom: 1px solid var(--border); background: var(--bg-window);
}
.shell-cm { flex: 1; min-width: 0; overflow: hidden; }
.shell-cm :deep(.cm-editor) { height: 100%; }
.shell-cm :deep(.cm-editor.cm-focused) { outline: none; }

/* results */
.shell-results { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.rtabs {
  display: flex; align-items: center;
  border-bottom: 1px solid var(--border); padding: 0 8px; flex: none;
}
.rtabs-spacer { flex: 1; }

.view-select-wrap { position: relative; }
.view-select {
  display: flex; align-items: center; gap: 5px; cursor: pointer;
  font-size: 12px; color: var(--text-dim); padding: 4px 6px;
}
.view-select:hover { color: var(--text); }
.view-menu {
  position: absolute; top: 100%; right: 0; z-index: 20;
  background: var(--bg-panel); border: 1px solid var(--border-soft);
  border-radius: 6px; padding: 4px; min-width: 130px; box-shadow: 0 8px 24px rgba(0,0,0,.4);
}
.view-menu-item {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  border-radius: 4px; font-size: 12px; color: var(--text); cursor: pointer;
}
.view-menu-item:hover { background: var(--bg-hover); }
.view-menu-item.on { color: var(--accent); }

.empty { padding: 32px; color: var(--text-faint); font-size: 12px; }

/* json view (matches ResultsPanel) */
.json-view { flex: 1; overflow: auto; padding: 12px 16px; }
.json-doc {
  font-family: var(--mono); font-size: 12.5px; line-height: 1.2; color: var(--text);
  white-space: pre; border-left: 2px solid var(--border-soft); padding: 8px 0 8px 14px; margin-bottom: 10px;
  -webkit-user-select: text; user-select: text;
}
.json-doc :deep(span) { -webkit-user-select: text; user-select: text; }
.json-doc :deep(.jk)  { color: var(--cell-key); }
.json-doc :deep(.jop) { color: var(--cell-op); }
.json-doc :deep(.js)  { color: var(--cell-str); }
.json-doc :deep(.jn)  { color: var(--cell-num); }
.json-doc :deep(.jb)  { color: var(--cell-num); }
.json-doc :deep(.jl)  { color: var(--text-faint); }
.json-doc :deep(.joid) { color: var(--link); }

/* tree view (matches ResultsPanel) */
.tree-view { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: auto; background: var(--bg-window); }
.tree-head {
  display: grid; grid-template-columns: minmax(220px, 1.4fr) minmax(160px, 2fr) 110px;
  position: sticky; top: 0; z-index: 2; height: 26px; align-items: center;
  background: var(--bg-toolbar); color: var(--text-dim); font-weight: 600; font-size: 11px;
  border-bottom: 1px solid var(--border);
}
.tree-head span { padding: 0 8px; border-right: 1px solid var(--border); height: 100%; display: flex; align-items: center; }
.tree-head .th-type { border-right: none; }
.tree-body { min-width: max-content; }

/* console */
.console {
  flex: 1; overflow: auto; padding: 10px 16px;
  font-family: var(--mono); font-size: 12.5px; line-height: 1.5;
}
.out-meta { color: var(--text-faint); font-size: 12px; margin-bottom: 12px; }
.c-log { color: var(--text-dim); white-space: pre-wrap; word-break: break-word; margin: 0 0 4px; }
.c-val { color: var(--text); white-space: pre-wrap; word-break: break-word; margin: 0; }
.c-err { color: var(--danger-text); white-space: pre-wrap; word-break: break-word; margin: 0; }
.console, .console :deep(span) { -webkit-user-select: text; user-select: text; }
.c-val :deep(.jk)  { color: var(--cell-key); }
.c-val :deep(.jop) { color: var(--cell-op); }
.c-val :deep(.js)  { color: var(--cell-str); }
.c-val :deep(.jn)  { color: var(--cell-num); }
.c-val :deep(.jb)  { color: var(--cell-num); }
.c-val :deep(.jl)  { color: var(--text-faint); }
.c-val :deep(.joid) { color: var(--link); }
</style>
