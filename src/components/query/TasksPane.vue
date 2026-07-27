<script setup>
import { ref, computed, reactive, onMounted, onBeforeUnmount } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog'
import { errText } from '../../utils/errors'
import { scheduleSummary, WEEKDAYS } from '../../utils/taskSchedule'
import { useToast } from '../../composables/useToast'
import BaseIcon from '../base/BaseIcon.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import FormField from '../base/FormField.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import SelectCard from '../base/SelectCard.vue'
import StateMessage from '../base/StateMessage.vue'
import { EXPORT_FORMATS, IMPORT_FORMATS, MASK_STRATEGIES } from '../../constants/dataTools'

// The Tasks panel: saved, parameterised invocations of an existing operation
// (Export / Import / Data Masking / IntelliShell Script) that the
// user can run on demand or on a schedule. Two views share this modal: the list of
// saved tasks (run / edit / delete, live-refreshed on the backend `task-ran` event)
// and the create/edit form.
const { showToast } = useToast()

// The five task types that map to an existing operation command, plus the two
// "coming soon" rows (no backing operation yet) shown disabled in the picker.
const TYPES = [
  { value: 'export',    label: 'Export',              icon: 'export',    enabled: true },
  { value: 'import',    label: 'Import',              icon: 'import',    enabled: true },
  { value: 'masking',   label: 'Data Masking',        icon: 'mask',      enabled: true },
  { value: 'shell',     label: 'IntelliShell Script', icon: 'shell',     enabled: true },
]
const TYPE_META = Object.fromEntries(TYPES.map(t => [t.value, t]))


const view = ref('list')            // 'list' | 'form'
const tasks = ref([])
const connections = ref([])
const databases = ref([])           // DatabaseInfo[] for the selected connection
const loading = ref(true)
const error = ref(null)
const saving = ref(false)
// Ids of tasks whose Run now is in flight, so their button shows a busy state.
const running = ref(new Set())

let unlisten = null

// The create/edit form. `id` empty means create.
const form = reactive(blankForm())

// ── BaseSelect option sets ──
// Excel is only offered for exports (import can't target .xlsx).
const formatOptions = computed(() => (form.type === 'export' ? EXPORT_FORMATS : IMPORT_FORMATS))
const WEEKDAY_OPTIONS = WEEKDAYS.map((d, i) => ({ value: i, label: d }))
const SCHED_OPTIONS = [
  { value: 'manual',   label: 'Manual (run on demand only)' },
  { value: 'interval', label: 'Every N minutes' },
  { value: 'daily',    label: 'Daily at a time' },
  { value: 'weekly',   label: 'Weekly on a day' },
]
const connOptions = computed(() => connections.value.map((c) => ({ value: c.id, label: c.name })))

// Picking a connection (was the native select's @change) reloads its database list.
function onConn(id) {
  form.connId = id
  loadDatabases()
}

function blankForm() {
  return {
    id: '',
    name: '',
    // Server-owned fields round-tripped on edit so saving a definition change never
    // clobbers the task's creation time or last-run state (upsert replaces the whole
    // record). Blank/null on create — the backend stamps created_at.
    createdAt: '',
    lastRun: null,
    lastStatus: null,
    type: 'export',
    connId: '',
    database: '',
    collection: '',
    path: '',
    format: 'json',
    filter: '{}',
    limit: '',
    code: '',
    rules: [],
    schedKind: 'manual',            // 'manual' | 'interval' | 'daily' | 'weekly'
    everyMinutes: 60,
    atHHMM: '09:00',
    weekday: 1,
  }
}

const dialogTitle = computed(() => {
  if (view.value === 'form') return form.id ? 'Edit Task' : 'New Task'
  return 'Tasks'
})

// Whether the currently selected type needs a collection (shell scripts don't).
const needsCollection = computed(() => form.type !== 'shell')

onMounted(async () => {
  await Promise.all([refresh(), loadConnections()])
  // The scheduler emits `task-ran` when it fires a task in the background; keep the
  // list current and toast the outcome.
  unlisten = await listen('task-ran', (event) => {
    refresh()
    const payload = event.payload
    if (payload && payload.run) {
      const name = taskName(payload.task_id)
      showToast(`${name || 'Task'} ran: ${payload.run.status}`)
    }
  })
})

onBeforeUnmount(() => {
  if (unlisten) unlisten()
})

async function refresh() {
  try {
    tasks.value = await invoke('list_tasks')
    error.value = null
  } catch (e) {
    error.value = errText(e)
  } finally {
    loading.value = false
  }
}

async function loadConnections() {
  try {
    connections.value = await invoke('list_connections')
  } catch (_) {
    connections.value = []
  }
}

// Try to fetch databases + collections for the selected connection so the form can
// offer suggestions. Best-effort: on failure the user just types names by hand.
async function loadDatabases() {
  databases.value = []
  if (!form.connId) return
  try {
    databases.value = await invoke('list_databases', { id: form.connId })
  } catch (_) {
    databases.value = []
  }
}

const collectionOptions = computed(() => {
  const db = databases.value.find(d => d.name === form.database)
  return db ? db.collections : []
})

function taskName(id) {
  const found = tasks.value.find(t => t.id === id)
  return found ? found.name : null
}

function typeMeta(task) {
  const kind = task.spec && task.spec.kind
  return TYPE_META[kind] || { label: kind || 'Task', icon: 'tasks' }
}

// Epoch-ms string -> short local date/time, or an em dash when never run.
function lastRunLabel(task) {
  if (!task.last_run) return '—'
  const ms = Number(task.last_run)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString()
}

async function runNow(task) {
  if (running.value.has(task.id)) return
  running.value = new Set(running.value).add(task.id)
  try {
    const run = await invoke('run_task', { id: task.id })
    showToast(`${task.name}: ${run.status === 'ok' ? 'ran successfully' : run.message}`)
    await refresh()
  } catch (e) {
    showToast(`${task.name} failed: ${errText(e)}`)
  } finally {
    const next = new Set(running.value)
    next.delete(task.id)
    running.value = next
  }
}

async function remove(task) {
  try {
    await invoke('delete_task', { id: task.id })
    await refresh()
    showToast(`Deleted "${task.name}"`)
  } catch (e) {
    showToast(`Could not delete: ${errText(e)}`)
  }
}

// ── Form ──────────────────────────────────────────────────────────────────

function startCreate() {
  Object.assign(form, blankForm())
  databases.value = []
  view.value = 'form'
}

async function startEdit(task) {
  const next = blankForm()
  next.id = task.id
  next.name = task.name
  next.createdAt = task.created_at
  next.lastRun = task.last_run
  next.lastStatus = task.last_status
  next.connId = task.connection_id
  const spec = task.spec || {}
  next.type = spec.kind || 'export'
  next.database = spec.database || ''
  next.collection = spec.collection || ''
  next.path = spec.path || ''
  next.format = spec.format || 'json'
  next.filter = spec.filter || '{}'
  next.limit = spec.limit == null ? '' : String(spec.limit)
  next.code = spec.code || ''
  next.rules = (spec.rules || []).map(r => ({
    field: r.field || '',
    strategy: r.strategy || 'redact',
    keepStart: r.keep_start == null ? '' : String(r.keep_start),
    keepEnd: r.keep_end == null ? '' : String(r.keep_end),
    maskChar: r.mask_char || '',
    replacement: r.replacement || '',
  }))
  const sched = task.schedule
  if (sched && sched.kind) {
    next.schedKind = sched.kind
    if (sched.every_minutes != null) next.everyMinutes = sched.every_minutes
    if (sched.at_hhmm) next.atHHMM = sched.at_hhmm
    if (sched.weekday != null) next.weekday = sched.weekday
  }
  Object.assign(form, next)
  view.value = 'form'
  await loadDatabases()
}

function cancelForm() {
  view.value = 'list'
}

function pickType(type) {
  const meta = TYPE_META[type]
  if (!meta || !meta.enabled) return
  form.type = type
  // Import can't read xlsx; fall back to JSON if the user had picked Excel for an export.
  if (type === 'import' && form.format === 'xlsx') form.format = 'json'
}

function addRule() {
  form.rules.push({ field: '', strategy: 'redact', keepStart: '4', keepEnd: '0', maskChar: '', replacement: '' })
}
function removeRule(index) {
  form.rules.splice(index, 1)
}

async function browseOutput() {
  try {
    const chosen = await saveDialog({ defaultPath: form.path || undefined })
    if (chosen) form.path = chosen
  } catch (_) {}
}
async function browseInput() {
  try {
    const chosen = await openDialog({ multiple: false, defaultPath: form.path || undefined })
    if (typeof chosen === 'string') form.path = chosen
  } catch (_) {}
}

function numOrNull(value) {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function buildRules() {
  return form.rules
    .filter(r => r.field.trim())
    .map(r => {
      const rule = { field: r.field.trim(), strategy: r.strategy }
      if (r.strategy === 'partial') {
        rule.keep_start = numOrNull(r.keepStart) ?? 0
        rule.keep_end = numOrNull(r.keepEnd) ?? 0
      }
      if (r.maskChar) rule.mask_char = r.maskChar
      if (r.replacement) rule.replacement = r.replacement
      return rule
    })
}

function buildSpec() {
  const database = form.database.trim()
  const collection = form.collection.trim()
  switch (form.type) {
    case 'export':
      return { kind: 'export', database, collection, path: form.path, format: form.format }
    case 'import':
      return { kind: 'import', database, collection, path: form.path, format: form.format }
    case 'masking':
      return {
        kind: 'masking', database, collection,
        filter: form.filter.trim() || '{}',
        rules: buildRules(),
        path: form.path, format: form.format,
        limit: numOrNull(form.limit),
      }
    case 'shell':
      return { kind: 'shell', database, code: form.code }
    default:
      return null
  }
}

function buildSchedule() {
  switch (form.schedKind) {
    case 'interval':
      return { kind: 'interval', every_minutes: numOrNull(form.everyMinutes) || 1 }
    case 'daily':
      return { kind: 'daily', at_hhmm: form.atHHMM || '09:00' }
    case 'weekly':
      return { kind: 'weekly', weekday: Number(form.weekday), at_hhmm: form.atHHMM || '09:00' }
    default:
      return null
  }
}

// Return an error string if the form is incomplete, else null.
function validate() {
  if (!form.name.trim()) return 'Give the task a name'
  if (!form.connId) return 'Choose a connection'
  if (!form.database.trim()) return 'Choose a database'
  if (needsCollection.value && !form.collection.trim()) return 'Choose a collection'
  if (form.type === 'shell' && !form.code.trim()) return 'Enter a script to run'
  if ((form.type === 'export' || form.type === 'import' || form.type === 'masking') && !form.path.trim()) {
    return 'Choose a file path'
  }
  if (form.schedKind === 'interval' && !(numOrNull(form.everyMinutes) > 0)) {
    return 'Interval must be at least 1 minute'
  }
  return null
}

async function save() {
  const problem = validate()
  if (problem) {
    showToast(problem)
    return
  }
  const spec = buildSpec()
  if (!spec) {
    showToast('That task type is not available yet')
    return
  }
  const task = {
    id: form.id || '',
    name: form.name.trim(),
    connection_id: form.connId,
    spec,
    schedule: buildSchedule(),
    created_at: form.createdAt || '',
    last_run: form.lastRun ?? null,
    last_status: form.lastStatus ?? null,
  }
  saving.value = true
  try {
    await invoke('save_task', { task })
    await refresh()
    view.value = 'list'
    showToast(form.id ? 'Task updated' : 'Task created')
  } catch (e) {
    showToast(`Could not save: ${errText(e)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="tasks-pane">
    <!-- Breadcrumb -->
    <div class="crumbs">
      <BaseIcon name="tasks" :size="15" class="c-ic" />
      <span class="crumb">{{ dialogTitle }}</span>
    </div>

      <!-- LIST VIEW -->
      <div class="tk-body" v-if="view === 'list'">
        <div class="tk-toolbar">
          <BaseButton variant="primary" size="sm" @click="startCreate">
            <BaseIcon name="plus" :size="13" /> New Task
          </BaseButton>
        </div>

        <StateMessage v-if="error" mode="error" :message="error" />

        <div v-if="loading" class="tk-empty">Loading…</div>

        <div v-else-if="!tasks.length" class="tk-empty">
          <BaseIcon name="tasks" :size="26" />
          <p>No tasks yet.</p>
          <span class="tk-empty-sub">Create a task to save an Export, Import, Masking or IntelliShell operation you can run on demand or on a schedule.</span>
        </div>

        <ul v-else class="tk-list">
          <li v-for="task in tasks" :key="task.id" class="tk-row">
            <div class="tk-icon"><BaseIcon :name="typeMeta(task).icon" :size="16" /></div>
            <div class="tk-main">
              <div class="tk-name">{{ task.name }}</div>
              <div class="tk-meta">
                <span class="tk-type">{{ typeMeta(task).label }}</span>
                <span class="tk-dot">·</span>
                <span class="tk-sched"><BaseIcon name="clock" :size="11" /> {{ scheduleSummary(task.schedule) }}</span>
              </div>
            </div>
            <div class="tk-status">
              <span v-if="task.last_status" :class="['tk-badge', task.last_status]">{{ task.last_status }}</span>
              <span class="tk-lastrun">{{ lastRunLabel(task) }}</span>
            </div>
            <div class="tk-actions">
              <BaseButton
                variant="primary"
                size="sm"
                :disabled="running.has(task.id)"
                :title="running.has(task.id) ? 'Running…' : 'Run now'"
                @click="runNow(task)"
              >
                <BaseIcon name="run" :size="13" />
                {{ running.has(task.id) ? 'Running…' : 'Run now' }}
              </BaseButton>
              <BaseButton icon="edit" :icon-size="14" title="Edit" @click="startEdit(task)" />
              <BaseButton icon="trash" :icon-size="14" variant="danger" title="Delete" @click="remove(task)" />
            </div>
          </li>
        </ul>
      </div>

      <!-- FORM VIEW -->
      <div class="tk-body" v-else>
        <!-- Type picker -->
        <FormField label="Task type">
          <div class="tk-types">
            <SelectCard
              v-for="t in TYPES"
              :key="t.value"
              :icon="t.icon"
              :label="t.label"
              :active="form.type === t.value"
              :disabled="!t.enabled"
              :soon="!t.enabled"
              :title="t.enabled ? '' : 'Coming soon'"
              @click="pickType(t.value)"
            />
          </div>
        </FormField>

        <FormField label="Name">
          <BaseInput v-model="form.name" class="tk-input" placeholder="e.g. Nightly orders export" />
        </FormField>

        <FormField label="Connection">
          <BaseSelect :model-value="form.connId" class="tk-select" :options="connOptions"
            placeholder="Select a connection…" @update:model-value="onConn" />
        </FormField>

        <div class="tk-two">
          <div class="tk-col">
            <FormField label="Database">
              <BaseInput v-model="form.database" list="tk-dblist" class="tk-input" placeholder="database" />
              <datalist id="tk-dblist">
                <option v-for="d in databases" :key="d.name" :value="d.name" />
              </datalist>
            </FormField>
          </div>
          <div class="tk-col" v-if="needsCollection">
            <FormField label="Collection">
              <BaseInput v-model="form.collection" list="tk-colllist" class="tk-input" placeholder="collection" />
              <datalist id="tk-colllist">
                <option v-for="c in collectionOptions" :key="c" :value="c" />
              </datalist>
            </FormField>
          </div>
        </div>

        <!-- Export / Import: format + path -->
        <template v-if="form.type === 'export' || form.type === 'import'">
          <FormField label="Format">
            <BaseSelect v-model="form.format" class="tk-select" :options="formatOptions" />
          </FormField>
          <FormField :label="form.type === 'import' ? 'Source file' : 'Destination file'">
            <div class="tk-path">
              <BaseInput v-model="form.path" class="tk-input" :placeholder="form.type === 'import' ? '/path/to/input' : '/path/to/output'" />
              <BaseButton bordered @click="form.type === 'import' ? browseInput() : browseOutput()">Browse…</BaseButton>
            </div>
          </FormField>
        </template>

        <!-- Masking: filter, limit, rules, format, path -->
        <template v-else-if="form.type === 'masking'">
          <FormField label="Filter (EJSON)">
            <BaseTextarea v-model="form.filter" class="tk-area" rows="2" spellcheck="false" placeholder="{}"></BaseTextarea>
          </FormField>
          <div class="tk-rules-head">
            <FormField label="Masking rules">
              <BaseButton variant="ghost" size="sm" @click="addRule"><BaseIcon name="plus" :size="11" /> Add rule</BaseButton>
            </FormField>
          </div>
          <div v-for="(rule, i) in form.rules" :key="i" class="tk-rule">
            <BaseInput v-model="rule.field" class="tk-input" placeholder="field.path" />
            <BaseSelect v-model="rule.strategy" class="tk-select narrow" :options="MASK_STRATEGIES" size="sm" />
            <template v-if="rule.strategy === 'partial'">
              <BaseInput v-model="rule.keepStart" class="tk-input tiny" placeholder="start" title="Keep first N chars" />
              <BaseInput v-model="rule.keepEnd" class="tk-input tiny" placeholder="end" title="Keep last N chars" />
            </template>
            <BaseButton icon="trash" :icon-size="13" variant="danger" title="Remove rule" @click="removeRule(i)" />
          </div>
          <div class="tk-two">
            <div class="tk-col">
              <FormField label="Format">
                <BaseSelect v-model="form.format" class="tk-select" :options="EXPORT_FORMATS" />
              </FormField>
            </div>
            <div class="tk-col">
              <FormField label="Limit (optional)">
                <BaseInput v-model="form.limit" class="tk-input" placeholder="e.g. 1000" />
              </FormField>
            </div>
          </div>
          <FormField label="Destination file">
            <div class="tk-path">
              <BaseInput v-model="form.path" class="tk-input" placeholder="/path/to/output" />
              <BaseButton bordered @click="browseOutput">Browse…</BaseButton>
            </div>
          </FormField>
        </template>

        <!-- Shell: code -->
        <template v-else-if="form.type === 'shell'">
          <FormField label="Script">
            <BaseTextarea v-model="form.code" class="tk-area" rows="5" spellcheck="false" placeholder="db.collection.find({}).count()"></BaseTextarea>
          </FormField>
        </template>

        <!-- Schedule -->
        <FormField label="Schedule">
          <BaseSelect v-model="form.schedKind" class="tk-select" :options="SCHED_OPTIONS" />
        </FormField>
        <div v-if="form.schedKind === 'interval'" class="tk-sched-row">
          <span>Every</span>
          <BaseInput v-model="form.everyMinutes" class="tk-input tiny" />
          <span>minutes</span>
        </div>
        <div v-else-if="form.schedKind === 'daily'" class="tk-sched-row">
          <span>At</span>
          <BaseInput v-model="form.atHHMM" type="time" class="tk-input narrow" />
        </div>
        <div v-else-if="form.schedKind === 'weekly'" class="tk-sched-row">
          <span>On</span>
          <BaseSelect v-model="form.weekday" class="tk-select narrow" :options="WEEKDAY_OPTIONS" size="sm" />
          <span>at</span>
          <BaseInput v-model="form.atHHMM" type="time" class="tk-input narrow" />
        </div>

        <div class="tk-form-actions">
          <BaseButton bordered @click="cancelForm">Cancel</BaseButton>
          <BaseButton variant="primary" size="sm" :disabled="saving" @click="save">
            <BaseIcon name="save" :size="13" /> {{ saving ? 'Saving…' : (form.id ? 'Save changes' : 'Create task') }}
          </BaseButton>
        </div>
      </div>
  </div>
</template>

<style scoped>
.tasks-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-window); }
.crumbs {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 14px; font-size: 12.5px; color: var(--text-dim);
  border-bottom: 1px solid var(--border); flex: none;
}
.c-ic { color: var(--text-faint); }
.tk-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px; }


.tk-toolbar { display: flex; justify-content: flex-end; }

.tk-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--text-faint);
  padding: 40px 20px;
  text-align: center;
}
.tk-empty p { margin: 0; font-size: 13px; color: var(--text-dim); }
.tk-empty-sub { font-size: 11.5px; max-width: 420px; }

.tk-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tk-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--bg-panel-2);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
}
.tk-icon { flex: none; color: var(--text-dim); display: flex; align-items: center; }
.tk-main { flex: 1; min-width: 0; }
.tk-name {
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tk-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-faint);
}
.tk-sched { display: inline-flex; align-items: center; gap: 4px; }
.tk-dot { opacity: .5; }

.tk-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  flex: none;
}
.tk-badge {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: .04em;
  padding: 1px 6px;
  border-radius: 4px;
}
.tk-badge.ok { background: var(--ok-soft, rgba(60,180,90,.18)); color: var(--ok, #4caf6a); }
.tk-badge.error { background: var(--err-soft, rgba(210,70,70,.18)); color: var(--err, #e06060); }
.tk-lastrun { font-size: 11px; color: var(--text-faint); }

.tk-actions { display: flex; align-items: center; gap: 6px; flex: none; }

/* Form */
.tk-input,
.base-input.tk-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 9px;
  font-size: 12.5px;
}
.tk-input:focus,
.base-input.tk-input:focus { outline: none; border-color: var(--accent); }
.base-textarea.tk-area { min-height: 0; }
.tk-input.narrow,
.base-input.tk-input.narrow { width: auto; min-width: 120px; }
.tk-select { width: 100%; }
.tk-select.narrow { width: auto; min-width: 120px; }
.tk-input.tiny,
.base-input.tk-input.tiny { width: 74px; }

.tk-two { display: flex; gap: 10px; }
.tk-col { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }

.tk-types {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 6px;
}

.tk-path { display: flex; gap: 8px; }

.tk-rules-head { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
.tk-rule { display: flex; gap: 6px; align-items: center; }

.tk-sched-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-dim);
}

.tk-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}
</style>
