<script setup>
import { ref, onMounted, computed } from 'vue'
import { serverStatus } from '../../engines/mongodb/api/admin'
import { errText, errCode } from '../../utils/errors'
import BaseIcon from '../base/BaseIcon.vue'
import RawToggle from '../base/RawToggle.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseModalBody from '../base/BaseModalBody.vue'
import BaseModal from '../base/BaseModal.vue'

// Opened from App.vue for a connection node. Fetches admin `serverStatus` once
// and surfaces the headline fields; the full document is available raw below.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const status = ref(null)
const showRaw = ref(false)

onMounted(async () => {
  try {
    status.value = await serverStatus(props.target.connId)
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
})

function fmtUptime(seconds) {
  if (seconds == null) return '—'
  const s = Math.floor(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const parts = []
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (m || (!d && !h)) parts.push(`${m}m`)
  return parts.join(' ')
}

function fmtMB(mb) {
  if (mb == null) return '—'
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

// serverStatus headline fields, guarded for servers that omit some sections.
const stats = computed(() => {
  const s = status.value
  if (!s) return []
  const conn = s.connections || {}
  const mem = s.mem || {}
  const net = s.network || {}
  return [
    { label: 'Host',              value: s.host || '—',                     icon: 'connect' },
    { label: 'Version',           value: s.version || '—',                  icon: 'dbSmall' },
    { label: 'Process',           value: s.process || '—',                  icon: 'shell' },
    { label: 'Uptime',            value: fmtUptime(s.uptime),               icon: 'clock' },
    { label: 'Current Conns',     value: conn.current ?? '—',               icon: 'connect' },
    { label: 'Available Conns',   value: conn.available ?? '—',             icon: 'connect' },
    { label: 'Resident Memory',   value: fmtMB(mem.resident),               icon: 'count' },
    { label: 'Virtual Memory',    value: fmtMB(mem.virtual),                icon: 'count' },
    { label: 'Network In',        value: net.bytesIn != null ? fmtMB(Math.round(net.bytesIn / 1048576)) : '—', icon: 'count' },
    { label: 'Network Out',       value: net.bytesOut != null ? fmtMB(Math.round(net.bytesOut / 1048576)) : '—', icon: 'count' },
  ]
})

const rawJson = computed(() =>
  status.value ? JSON.stringify(status.value, null, 2) : ''
)
</script>

<template>
  <BaseModal :title="`Server Status — ${target.connName}`" width="640px" max-width="92vw" @close="$emit('close')">

      <BaseModalBody>
        <StateMessage v-if="loading" mode="loading" label="Fetching server status…" />
        <StateMessage
          v-else-if="error"
          mode="error"
          :message="error"
          :code="errorCode"
        />
        <template v-else>
          <div class="ss-grid">
            <div v-for="stat in stats" :key="stat.label" class="ss-card">
              <span class="ss-ic"><BaseIcon :name="stat.icon" :size="15" /></span>
              <div class="ss-meta">
                <div class="ss-label">{{ stat.label }}</div>
                <div class="ss-value">{{ stat.value }}</div>
              </div>
            </div>
          </div>

          <RawToggle v-model="showRaw" label="Raw serverStatus" />
          <pre v-if="showRaw" class="ss-raw">{{ rawJson }}</pre>
        </template>
      </BaseModalBody>
    </BaseModal>
</template>

<style scoped>



.ss-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.ss-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.ss-ic { color: var(--text-faint); flex: none; }
.ss-meta { min-width: 0; }
.ss-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }
.ss-value {
  font-size: 13.5px;
  color: var(--text);
  margin-top: 2px;
  word-break: break-word;
  user-select: text;
}

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
