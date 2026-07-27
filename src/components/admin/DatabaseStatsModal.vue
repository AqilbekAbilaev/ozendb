<script setup>
import { ref, onMounted, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { errText, errCode } from '../../utils/errors'
import BaseIcon from '../base/BaseIcon.vue'
import RawToggle from '../base/RawToggle.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseModalBody from '../base/BaseModalBody.vue'
import BaseModal from '../base/BaseModal.vue'
import { fmtBytes, fmtNum } from '../../utils/format'

// Opened from App.vue for a database node. Fetches `dbStats` once and surfaces the
// headline fields; the full document is available raw below.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, dbName }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const stats = ref(null)
const showRaw = ref(false)

onMounted(async () => {
  try {
    stats.value = await invoke('database_stats', {
      id: props.target.connId,
      database: props.target.dbName,
    })
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
})



// dbStats headline fields, guarded for servers that omit some.
const cards = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { label: 'Database',     value: s.db || props.target.dbName || '—', icon: 'dbSmall' },
    { label: 'Collections',  value: fmtNum(s.collections),              icon: 'count' },
    { label: 'Objects',      value: fmtNum(s.objects),                  icon: 'count' },
    { label: 'Data Size',    value: fmtBytes(s.dataSize),               icon: 'count' },
    { label: 'Storage Size', value: fmtBytes(s.storageSize),            icon: 'count' },
    { label: 'Indexes',      value: fmtNum(s.indexes),                  icon: 'count' },
    { label: 'Index Size',   value: fmtBytes(s.indexSize),              icon: 'count' },
    { label: 'Avg Obj Size', value: fmtBytes(s.avgObjSize),             icon: 'count' },
  ]
})

const rawJson = computed(() =>
  stats.value ? JSON.stringify(stats.value, null, 2) : ''
)
</script>

<template>
  <BaseModal :title="`Database Statistics — ${target.dbName}`" width="640px" max-width="92vw" @close="$emit('close')">

      <BaseModalBody>
        <StateMessage v-if="loading" mode="loading" label="Fetching database statistics…" />
        <StateMessage
          v-else-if="error"
          mode="error"
          :message="error"
          :code="errorCode"
        />
        <template v-else>
          <div class="ss-grid">
            <div v-for="card in cards" :key="card.label" class="ss-card">
              <span class="ss-ic"><BaseIcon :name="card.icon" :size="15" /></span>
              <div class="ss-meta">
                <div class="ss-label">{{ card.label }}</div>
                <div class="ss-value">{{ card.value }}</div>
              </div>
            </div>
          </div>

          <RawToggle v-model="showRaw" label="Raw dbStats" />
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
