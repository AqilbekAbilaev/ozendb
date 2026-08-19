<script setup>
import { ref, onMounted, computed } from 'vue'
import { getProfilingStatus, setProfilingLevel, listProfile } from '../../engines/mongodb/api/admin'
import { errText, errCode } from '../../utils/errors'
import BaseIcon from '../base/BaseIcon.vue'
import BaseSelect from '../base/BaseSelect.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseModalBody from '../base/BaseModalBody.vue'

// Opened from App.vue for a database node. Reads the database's profiling status,
// lists the slow ops captured in `system.profile`, and lets the user change the
// profiling level / slow-op threshold. Profiling is per-database in MongoDB.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, dbName }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const status = ref(null)      // raw { profile: n, slowms: n } result
const entries = ref([])       // system.profile documents

// Control-bar state: the level/threshold the user is about to apply.
const level = ref(1)
const slowms = ref(100)
const applying = ref(false)

// Filter state for the list.
const slowerThan = ref(null)
const refreshing = ref(false)

// Which row is expanded to show its raw profile document.
const expanded = ref(null)

const LEVEL_LABELS = { 0: 'Off', 1: 'Slow ops', 2: 'All' }
const LEVEL_OPTIONS = [0, 1, 2].map((v) => ({ value: v, label: LEVEL_LABELS[v] }))

const currentLevel = computed(() =>
  status.value && typeof status.value.was === 'number' ? status.value.was : null
)
const currentLevelLabel = computed(() =>
  currentLevel.value != null ? (LEVEL_LABELS[currentLevel.value] ?? currentLevel.value) : '—'
)

async function fetchStatus() {
  status.value = await getProfilingStatus(
      { connectionId: props.target.connId, database: props.target.dbName },
    )
  // Seed the control bar from the live status the first time we learn it.
  if (status.value && typeof status.value.was === 'number') {
    level.value = status.value.was
  }
  if (status.value && typeof status.value.slowms === 'number') {
    slowms.value = status.value.slowms
  }
}

async function fetchList() {
  entries.value = await listProfile(
      { connectionId: props.target.connId, database: props.target.dbName },
      50,
      slowerThan.value != null && slowerThan.value !== '' ? Number(slowerThan.value) : null,
    )
}

onMounted(async () => {
  try {
    await fetchStatus()
    await fetchList()
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
})

async function applyLevel() {
  applying.value = true
  error.value = null
  errorCode.value = null
  try {
    await setProfilingLevel(
      { connectionId: props.target.connId, database: props.target.dbName },
      Number(level.value),
      Number(slowms.value),
    )
    await fetchStatus()
    await fetchList()
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    applying.value = false
  }
}

async function refreshList() {
  refreshing.value = true
  error.value = null
  errorCode.value = null
  try {
    await fetchList()
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    refreshing.value = false
  }
}

// The profile entries, normalized to the columns we show.
const rows = computed(() =>
  entries.value.map((op) => ({
    ts: formatTs(op.ts),
    op: op.op || '—',
    ns: op.ns || '—',
    millis: op.millis != null ? op.millis : '—',
    planSummary: op.planSummary || '—',
    docsExamined: op.docsExamined != null ? op.docsExamined : '—',
    nreturned: op.nreturned != null ? op.nreturned : '—',
    raw: op,
  }))
)

// Extended-JSON dates arrive as { $date: … }; render the plain string when we can.
function formatTs(ts) {
  if (ts == null) return '—'
  if (typeof ts === 'object' && ts.$date != null) {
    const value = ts.$date
    if (typeof value === 'string') return value
    if (value && typeof value === 'object' && value.$numberLong != null) {
      return new Date(Number(value.$numberLong)).toISOString()
    }
    return String(value)
  }
  return String(ts)
}

function toggleRow(i) {
  expanded.value = expanded.value === i ? null : i
}

function rawFor(op) {
  return JSON.stringify(op, null, 2)
}
</script>

<template>
  <BaseModal :title="`Query Profiler — ${target.dbName}`" width="860px" max-width="92vw" @close="$emit('close')">

      <BaseModalBody>
        <StateMessage v-if="loading" mode="loading" label="Reading profiling status…" />
        <template v-else>
          <div class="ctrl-bar">
            <span class="ctrl-label">Profiling</span>
            <span class="badge" :class="'lvl-' + (currentLevel ?? 'na')">{{ currentLevelLabel }}</span>
            <BaseSelect v-model="level" class="ctrl-select" :options="LEVEL_OPTIONS" size="sm" />
            <label class="ctrl-inline">
              slowms
              <BaseInput v-model="slowms" type="number" min="0" class="ctrl-num" />
            </label>
            <BaseButton bordered :disabled="applying" @click="applyLevel">
              {{ applying ? 'Applying…' : 'Apply' }}
            </BaseButton>
          </div>

          <div class="filter-bar">
            <label class="ctrl-inline">
              slower than
              <BaseInput v-model="slowerThan" type="number" min="0" class="ctrl-num" placeholder="—" />
              ms
            </label>
            <BaseButton bordered :disabled="refreshing" @click="refreshList">
              {{ refreshing ? 'Refreshing…' : 'Refresh' }}
            </BaseButton>
          </div>

          <StateMessage
            v-if="error"
            mode="error"
            :message="error"
            :code="errorCode"
          />

          <StateMessage
            v-if="!rows.length && !error"
            mode="empty"
            label="No profiled operations — enable profiling above to start capturing slow queries"
          />
          <table v-else-if="rows.length" class="ops-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Op</th>
                <th>Namespace</th>
                <th>ms</th>
                <th>Plan</th>
                <th>Docs examined</th>
                <th>Returned</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(row, i) in rows" :key="i">
                <tr class="op-row" @click="toggleRow(i)">
                  <td>{{ row.ts }}</td>
                  <td>{{ row.op }}</td>
                  <td>{{ row.ns }}</td>
                  <td>{{ row.millis }}</td>
                  <td>{{ row.planSummary }}</td>
                  <td>{{ row.docsExamined }}</td>
                  <td>{{ row.nreturned }}</td>
                </tr>
                <tr v-if="expanded === i" :key="'raw-' + i">
                  <td colspan="7" class="raw-cell">
                    <pre class="ss-raw">{{ rawFor(row.raw) }}</pre>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </template>
      </BaseModalBody>
    </BaseModal>
</template>

<style scoped>



.ctrl-bar,
.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ctrl-label {
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.ctrl-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-dim);
}
.badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--text-dim);
}
.badge.lvl-0 { color: var(--text-faint); }
.badge.lvl-1 { color: var(--accent); border-color: var(--accent); }
.badge.lvl-2 { color: var(--accent); border-color: var(--accent); }

.ctrl-select { min-width: 120px; }
.base-input.ctrl-num {
  font-size: 12.5px;
  padding: 4px 8px;
  width: 84px;
}


.ops-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.ops-table th {
  text-align: left;
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: .04em;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.ops-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  user-select: text;
  word-break: break-word;
}
.op-row { cursor: pointer; }
.op-row:hover td { background: var(--bg-hover); }
.raw-cell { padding: 0 8px 8px; }

.ss-raw {
  margin: 0;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--text-dim);
  white-space: pre;
  overflow-x: auto;
  user-select: text;
}
</style>
