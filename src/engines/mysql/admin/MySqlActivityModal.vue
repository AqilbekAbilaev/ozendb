<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { processes as listProcesses, killQuery, killConnection } from '../api/admin'
import { errText, errCode } from '../../../utils/errors'
import { matchProcesses, processOptions, queryText, fmtSeconds } from './processRows'
import { showToast } from '../../../stores/toast'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import BaseSelect from '../../../components/base/BaseSelect.vue'
import HintText from '../../../components/base/HintText.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// Opened from a MySQL connection's right-click menu: every connection on the server this
// login may see, refreshing on a timer like PostgreSQL's Server Activity, with Kill query
// (graceful) and Kill connection (confirmed) per connection.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, … }
})
defineEmits(['close'])

const REFRESH_MS = 3000

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const all = ref([])
const filters = ref({ user: '', database: '', command: '', activeOnly: false })
const auto = ref(true)
const confirming = ref(null)   // the process a Kill connection is being confirmed for
let timer = null

async function load() {
  try {
    all.value = await listProcesses(props.target.connId)
    error.value = null
    errorCode.value = null
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  load()
  timer = setInterval(() => { if (auto.value && !confirming.value) load() }, REFRESH_MS)
})
onUnmounted(() => clearInterval(timer))

const shown = computed(() => matchProcesses(all.value, filters.value))
const options = computed(() => processOptions(all.value))
const asOptions = (values, label) => [{ value: '', label }, ...values.map(v => ({ value: v, label: v }))]

async function kill(process, what) {
  try {
    const done = await (what === 'connection' ? killConnection : killQuery)(props.target.connId, process.id)
    showToast(done
      ? `${what === 'connection' ? 'Closed connection' : 'Stopped the statement of connection'} ${process.id}`
      : `Connection ${process.id} is already gone`)
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
        <div class="ma-bar">
          <BaseSelect v-model="filters.user" :options="asOptions(options.users, 'Every user')" />
          <BaseSelect v-model="filters.database" :options="asOptions(options.databases, 'Every database')" />
          <BaseSelect v-model="filters.command" :options="asOptions(options.commands, 'Every command')" />
          <BaseButton :active="filters.activeOnly" bordered icon="run" @click="filters.activeOnly = !filters.activeOnly">
            Active only
          </BaseButton>
          <FlexSpacer />
          <span class="ma-count">{{ shown.length }} of {{ all.length }}</span>
          <BaseButton :active="auto" bordered icon="clock" title="Re-read every few seconds" @click="auto = !auto">
            Auto
          </BaseButton>
          <BaseButton variant="ghost" icon="refresh" title="Refresh now" @click="load" />
        </div>

        <!-- A failed refresh keeps the last good list on screen rather than blanking it. -->
        <div v-if="error" class="ma-stale">{{ error }}</div>

        <div v-if="!shown.length" class="ma-empty">No connection matches these filters.</div>
        <table v-else class="ma-table">
          <thead>
            <tr><th>ID</th><th>User</th><th>Host</th><th>Database</th><th>Command</th><th>Time</th><th>Query</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="p in shown" :key="p.id" :class="{ self: p.isSelf, active: !p.idle }">
              <td class="ma-id">
                {{ p.id }}
                <span v-if="p.isSelf" class="ma-self" title="This is OzenDB's own connection">this app</span>
              </td>
              <td>{{ p.user }}</td>
              <td>{{ p.host ?? '—' }}</td>
              <td>{{ p.database ?? '—' }}</td>
              <td :title="p.state ?? ''">{{ p.command }}</td>
              <td class="ma-time">{{ fmtSeconds(p.seconds) }}</td>
              <td class="ma-query" :title="queryText(p)">{{ queryText(p) }}</td>
              <td class="ma-actions">
                <template v-if="!p.isSelf">
                  <BaseButton variant="ghost" size="sm" title="Stop this statement; the connection stays open" @click="kill(p, 'query')">
                    Kill query
                  </BaseButton>
                  <BaseButton variant="ghost" size="sm" class="ma-kill" title="Close the whole connection" @click="confirming = p">
                    Kill connection
                  </BaseButton>
                </template>
              </td>
            </tr>
          </tbody>
        </table>

        <HintText dim>Without the PROCESS privilege, MySQL lists only this login's own connections.</HintText>

        <!-- Closing a connection rolls back its transaction and disconnects the client, so
             it asks first; stopping a statement doesn't, being recoverable. -->
        <div v-if="confirming" class="ma-confirm">
          <span>
            Close connection {{ confirming.id }} ({{ confirming.user }})?
            Its transaction is rolled back and the client is disconnected.
          </span>
          <FlexSpacer />
          <BaseButton variant="ghost" @click="confirming = null">Cancel</BaseButton>
          <BaseButton variant="danger" @click="kill(confirming, 'connection')">Kill connection</BaseButton>
        </div>
      </template>
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.ma-bar { display: flex; align-items: center; gap: 6px; margin: 12px 0 8px; }
.ma-count { font-size: 12px; color: var(--text-faint); }
.ma-empty { padding: 20px 2px; color: var(--text-faint); font-size: 12.5px; }
.ma-stale {
  padding: 6px 10px; margin-bottom: 8px; font-size: 12px;
  color: var(--danger-text); background: var(--danger-bg); border-radius: 5px;
}
.ma-table { width: 100%; border-collapse: collapse; font-size: 12.5px; display: block; max-height: 56vh; overflow-y: auto; }
.ma-table th {
  position: sticky; top: 0; text-align: left; padding: 6px 8px; font-weight: 600;
  color: var(--text-dim); background: var(--bg-panel-2); border-bottom: 1px solid var(--border);
}
.ma-table td { padding: 5px 8px; border-bottom: 1px solid var(--border-soft); user-select: text; white-space: nowrap; }
tr.self td { background: var(--bg-row-alt); }
tr.active .ma-time { color: var(--text); }
.ma-id { font-family: var(--mono); }
.ma-self {
  margin-left: 6px; padding: 1px 5px; border-radius: 3px;
  font-size: 10.5px; color: var(--text-faint); background: var(--bg-hover);
}
.ma-time { font-family: var(--mono); color: var(--text-dim); }
.ma-query {
  font-family: var(--mono); font-size: 11.5px; max-width: 360px;
  overflow: hidden; text-overflow: ellipsis;
}
.ma-actions { text-align: right; }
.ma-kill :deep(*) { color: var(--danger-text); }
.ma-confirm {
  display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 10px;
  font-size: 12.5px; color: var(--text); background: var(--danger-bg);
  border: 1px solid var(--danger-text); border-radius: 6px;
}
</style>
