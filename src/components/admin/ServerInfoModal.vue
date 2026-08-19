<script setup>
import { ref, onMounted, computed } from 'vue'
import { serverInfo } from '../../engines/mongodb/api/admin'
import { errText, errCode } from '../../utils/errors'
import BaseIcon from '../base/BaseIcon.vue'
import RawToggle from '../base/RawToggle.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseModalBody from '../base/BaseModalBody.vue'
import BaseModal from '../base/BaseModal.vue'

// Reused for the extra Server Info menu entries (Build Info / Host Info / Replica
// Set Status). Shows the flat scalar fields as cards and the full document raw.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, kind, title }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const data = ref(null)
const showRaw = ref(false)

onMounted(async () => {
  try {
    data.value = await serverInfo(props.target.connId, props.target.kind)
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
})

// Surface the flat, human-meaningful top-level scalars as cards; nested objects
// and arrays stay in the raw view (they vary a lot across server versions).
const cards = computed(() => {
  const d = data.value
  if (!d || typeof d !== 'object') return []
  const out = []
  for (const [key, value] of Object.entries(d)) {
    if (key === 'ok') continue
    const t = typeof value
    if (t === 'string' || t === 'number' || t === 'boolean') {
      out.push({ label: key, value: String(value) })
    }
  }
  return out
})

const rawJson = computed(() => (data.value ? JSON.stringify(data.value, null, 2) : ''))
</script>

<template>
  <BaseModal :title="`${target.title} — ${target.connName}`" width="640px" max-width="92vw" @close="$emit('close')">

      <BaseModalBody>
        <StateMessage v-if="loading" mode="loading" :label="`Fetching ${target.title.toLowerCase()}…`" />
        <StateMessage
          v-else-if="error"
          mode="error"
          :message="error"
          :code="errorCode"
        />
        <template v-else>
          <div v-if="cards.length" class="ss-grid">
            <div v-for="card in cards" :key="card.label" class="ss-card">
              <div class="ss-meta">
                <div class="ss-label">{{ card.label }}</div>
                <div class="ss-value">{{ card.value }}</div>
              </div>
            </div>
          </div>

          <RawToggle v-model="showRaw" label="Raw response" />
          <pre v-if="showRaw || !cards.length" class="ss-raw">{{ rawJson }}</pre>
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
.ss-meta { min-width: 0; }
.ss-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }
.ss-value { font-size: 13.5px; color: var(--text); margin-top: 2px; word-break: break-word; user-select: text; }

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
