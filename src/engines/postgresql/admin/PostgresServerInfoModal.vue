<script setup>
import { ref, computed, onMounted } from 'vue'
import { serverInfo, serverSettings } from '../api/admin'
import { errText, errCode } from '../../../utils/errors'
import { summaryCards, matchSettings } from './serverInfoRows'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import TabStrip from '../../../components/base/TabStrip.vue'

// Opened from a PostgreSQL connection's right-click menu. Read-only diagnostics: the
// settings list reports where each value came from, and never offers to change it.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, … } from the tree node
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const info = ref(null)
const settings = ref([])
const tab = ref('Overview')
const search = ref('')

onMounted(async () => {
  try {
    // Both reads are independent, so they go together rather than one after the other.
    const [read, rows] = await Promise.all([
      serverInfo(props.target.connId),
      serverSettings(props.target.connId),
    ])
    info.value = read
    settings.value = rows
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
})

const cards = computed(() => summaryCards(info.value))
const shown = computed(() => matchSettings(settings.value, search.value))
const tabs = computed(() => [
  { value: 'Overview', label: 'Overview' },
  { value: 'Settings', label: 'Settings', count: settings.value.length },
  { value: 'Extensions', label: 'Extensions', count: info.value?.extensions?.length ?? 0 },
])
</script>

<template>
  <BaseModal :title="`Server Info — ${target.connName}`" width="760px" max-width="94vw" @close="$emit('close')">
    <BaseModalBody>
      <StateMessage v-if="loading" mode="loading" label="Reading server information…" />
      <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" />
      <template v-else>
        <TabStrip v-model="tab" :options="tabs" />

        <template v-if="tab === 'Overview'">
          <div class="si-grid">
            <div v-for="card in cards" :key="card.label" class="si-card">
              <span class="si-ic"><BaseIcon :name="card.icon" :size="15" /></span>
              <div class="si-meta">
                <div class="si-label">{{ card.label }}</div>
                <div class="si-value">{{ card.value }}</div>
              </div>
            </div>
          </div>
          <div class="si-banner">{{ info.version }}</div>
        </template>

        <template v-else-if="tab === 'Settings'">
          <BaseInput v-model="search" placeholder="Search a setting by name, value or description…" class="si-search" />
          <div v-if="!shown.length" class="si-empty">No setting matches “{{ search }}”.</div>
          <table v-else class="si-table">
            <thead>
              <tr><th>Name</th><th>Value</th><th>Source</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in shown" :key="s.name">
                <td>
                  <span class="si-name">{{ s.name }}</span>
                  <span v-if="s.pendingRestart" class="si-flag" title="Changed; a restart is needed before it takes effect">restart pending</span>
                  <div v-if="s.shortDesc" class="si-desc">{{ s.shortDesc }}</div>
                </td>
                <td class="si-set">{{ s.setting }}<span v-if="s.unit" class="si-unit"> {{ s.unit }}</span></td>
                <td class="si-src" :title="s.sourceFile || ''">{{ s.source }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-else>
          <div v-if="!info.extensions.length" class="si-empty">No extensions are installed.</div>
          <table v-else class="si-table">
            <thead>
              <tr><th>Name</th><th>Version</th><th>Schema</th></tr>
            </thead>
            <tbody>
              <tr v-for="ext in info.extensions" :key="ext.name">
                <td><span class="si-name">{{ ext.name }}</span></td>
                <td class="si-set">{{ ext.version }}</td>
                <td class="si-src">{{ ext.schema }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </template>
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.si-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px; }
.si-card {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
}
.si-ic { color: var(--text-faint); flex: none; }
.si-meta { min-width: 0; }
.si-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }
.si-value { font-size: 13.5px; color: var(--text); margin-top: 2px; word-break: break-word; user-select: text; }
.si-banner {
  margin-top: 12px; padding: 8px 10px; font-family: var(--mono); font-size: 11.5px;
  color: var(--text-dim); background: var(--bg-input); border-radius: 6px; user-select: text;
}
.si-search { width: 100%; margin: 12px 0 8px; }
.si-empty { padding: 20px 2px; color: var(--text-faint); font-size: 12.5px; }
/* The settings list is long by nature, so it scrolls inside the modal rather than
   making the modal itself tall enough to lose its header. */
.si-table { width: 100%; border-collapse: collapse; font-size: 12.5px; display: block; max-height: 52vh; overflow-y: auto; }
.si-table th {
  position: sticky; top: 0; text-align: left; padding: 6px 8px; font-weight: 600;
  color: var(--text-dim); background: var(--bg-panel-2); border-bottom: 1px solid var(--border);
}
.si-table td { padding: 6px 8px; border-bottom: 1px solid var(--border-soft); vertical-align: top; user-select: text; }
.si-name { font-family: var(--mono); color: var(--text); }
.si-desc { margin-top: 2px; color: var(--text-faint); font-size: 11.5px; }
.si-flag {
  margin-left: 6px; padding: 1px 5px; border-radius: 3px; font-size: 10.5px;
  color: var(--warn-text, var(--text)); background: var(--bg-hover);
}
.si-set { font-family: var(--mono); white-space: nowrap; }
.si-unit { color: var(--text-faint); }
.si-src { color: var(--text-dim); white-space: nowrap; }
</style>
