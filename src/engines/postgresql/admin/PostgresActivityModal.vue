<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { sessions as listSessions, cancelBackend, terminateBackend } from '../api/admin'
import { errText, errCode } from '../../../utils/errors'
import { matchSessions, sessionOptions, queryText, fmtAge } from './sessionRows'
import { showToast } from '../../../stores/toast'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import BaseSelect from '../../../components/base/BaseSelect.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// Opened from a PostgreSQL connection's right-click menu: every session on the server,
// not only the ones this app opened. Refreshes on a timer like MongoDB's Current
// Operations, and offers cancel (graceful) and terminate (confirmed) per session.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, … }
})
defineEmits(['close'])

const REFRESH_MS = 3000

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const all = ref([])
const filters = ref({ database: '', user: '', state: '', activeOnly: false })
const auto = ref(true)
const confirming = ref(null)   // the session a terminate is being confirmed for
const now = ref(new Date())
let timer = null

async function load() {
  try {
    all.value = await listSessions(props.target.connId)
    error.value = null
    errorCode.value = null
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
    now.value = new Date()
  }
}

onMounted(() => {
  load()
  // One timer, restarted rather than stacked: a slow server must not queue reads.
  timer = setInterval(() => { if (auto.value && !confirming.value) load() }, REFRESH_MS)
})
onUnmounted(() => clearInterval(timer))

const shown = computed(() => matchSessions(all.value, filters.value))
const options = computed(() => sessionOptions(all.value))
const asOptions = (values, label) => [{ value: '', label }, ...values.map(v => ({ value: v, label: v }))]

async function signal(session, kind) {
  const call = kind === 'terminate' ? terminateBackend : cancelBackend
  try {
    const done = await call(props.target.connId, session.pid)
    showToast(done
      ? `${kind === 'terminate' ? 'Terminated' : 'Cancelled'} session ${session.pid}`
      : `Session ${session.pid} is already gone, or you may not signal it`)
  } catch (e) {
    showToast(errText(e))
  } finally {
    confirming.value = null
    load()
  }
}
</script>

<template>
  <BaseModal :title="`Server Activity — ${target.connName}`" width="1000px" max-width="96vw" @close="$emit('close')">
    <BaseModalBody>
      <StateMessage v-if="loading" mode="loading" label="Reading server activity…" />
      <StateMessage v-else-if="error && !all.length" mode="error" :message="error" :code="errorCode" retryable @retry="load" />
      <template v-else>
        <div class="pa-bar">
          <BaseSelect v-model="filters.database" :options="asOptions(options.databases, 'Every database')" />
          <BaseSelect v-model="filters.user" :options="asOptions(options.users, 'Every user')" />
          <BaseSelect v-model="filters.state" :options="asOptions(options.states, 'Every state')" />
          <BaseButton :active="filters.activeOnly" bordered icon="run" @click="filters.activeOnly = !filters.activeOnly">
            Active only
          </BaseButton>
          <FlexSpacer />
          <span class="pa-count">{{ shown.length }} of {{ all.length }}</span>
          <BaseButton :active="auto" bordered icon="clock" title="Re-read every few seconds" @click="auto = !auto">
            Auto
          </BaseButton>
          <BaseButton variant="ghost" icon="refresh" title="Refresh now" @click="load" />
        </div>

        <!-- A failed refresh keeps the last good list on screen rather than blanking it. -->
        <div v-if="error" class="pa-stale">{{ error }}</div>

        <div v-if="!shown.length" class="pa-empty">No session matches these filters.</div>
        <table v-else class="pa-table">
          <thead>
            <tr><th>PID</th><th>User</th><th>Database</th><th>State</th><th>Age</th><th>Query</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="s in shown" :key="s.pid" :class="{ self: s.isSelf, active: s.state === 'active' }">
              <td class="pa-pid">
                {{ s.pid }}
                <span v-if="s.isSelf" class="pa-self" title="This is OzenDB's own connection">this app</span>
              </td>
              <td>{{ s.user ?? '—' }}</td>
              <td>{{ s.database ?? '—' }}</td>
              <td>
                {{ s.state ?? '—' }}
                <span v-if="s.waitEventType" class="pa-wait" :title="`Waiting on ${s.waitEventType}: ${s.waitEvent}`">
                  waiting
                </span>
              </td>
              <td class="pa-age">{{ fmtAge(s.queryStart, now) }}</td>
              <td class="pa-query" :class="{ hidden: s.redacted }" :title="queryText(s)">{{ queryText(s) }}</td>
              <td class="pa-actions">
                <template v-if="!s.isSelf">
                  <BaseButton variant="ghost" size="sm" title="Stop this statement; the session stays open" @click="signal(s, 'cancel')">
                    Cancel
                  </BaseButton>
                  <BaseButton variant="ghost" size="sm" class="pa-kill" title="Close the whole session" @click="confirming = s">
                    Terminate
                  </BaseButton>
                </template>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Terminate rolls back whatever the session was doing and disconnects the
             client, so it asks first; Cancel doesn't, being recoverable. -->
        <div v-if="confirming" class="pa-confirm">
          <BaseIcon name="warn" :size="15" />
          <span>
            Terminate session {{ confirming.pid }}<template v-if="confirming.user"> ({{ confirming.user }})</template>?
            Its transaction is rolled back and the client is disconnected.
          </span>
          <FlexSpacer />
          <BaseButton variant="ghost" @click="confirming = null">Cancel</BaseButton>
          <BaseButton variant="danger" @click="signal(confirming, 'terminate')">Terminate</BaseButton>
        </div>
      </template>
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.pa-bar { display: flex; align-items: center; gap: 6px; margin: 12px 0 8px; }
.pa-count { font-size: 12px; color: var(--text-faint); }
.pa-empty { padding: 20px 2px; color: var(--text-faint); font-size: 12.5px; }
.pa-stale {
  padding: 6px 10px; margin-bottom: 8px; font-size: 12px;
  color: var(--danger-text); background: var(--danger-bg); border-radius: 5px;
}
.pa-table { width: 100%; border-collapse: collapse; font-size: 12.5px; display: block; max-height: 56vh; overflow-y: auto; }
.pa-table th {
  position: sticky; top: 0; text-align: left; padding: 6px 8px; font-weight: 600;
  color: var(--text-dim); background: var(--bg-panel-2); border-bottom: 1px solid var(--border);
}
.pa-table td { padding: 5px 8px; border-bottom: 1px solid var(--border-soft); user-select: text; white-space: nowrap; }
tr.self td { background: var(--bg-row-alt); }
tr.active .pa-age { color: var(--text); }
.pa-pid { font-family: var(--mono); }
.pa-self, .pa-wait {
  margin-left: 6px; padding: 1px 5px; border-radius: 3px;
  font-size: 10.5px; color: var(--text-faint); background: var(--bg-hover);
}
.pa-age { font-family: var(--mono); color: var(--text-dim); }
.pa-query {
  font-family: var(--mono); font-size: 11.5px; max-width: 420px;
  overflow: hidden; text-overflow: ellipsis;
}
.pa-query.hidden { color: var(--text-faint); font-style: italic; font-family: inherit; }
.pa-actions { text-align: right; }
.pa-kill :deep(*) { color: var(--danger-text); }
.pa-confirm {
  display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 10px;
  font-size: 12.5px; color: var(--text); background: var(--danger-bg);
  border: 1px solid var(--danger-text); border-radius: 6px;
}
</style>
