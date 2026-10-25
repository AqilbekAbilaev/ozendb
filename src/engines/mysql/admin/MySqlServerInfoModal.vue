<script setup>
import { ref, computed, onMounted } from 'vue'
import { serverInfo } from '../api/admin'
import { errText, errCode } from '../../../utils/errors'
import { summaryCards, serverBanner, matchValues } from './serverInfoRows'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import TabStrip from '../../../components/base/TabStrip.vue'

// Opened from a MySQL connection's right-click menu. Read-only: the variables are
// reported, never set.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, … } from the tree node
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const info = ref(null)
const tab = ref('Overview')
const search = ref('')

onMounted(async () => {
  try {
    info.value = await serverInfo(props.target.connId)
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
})

const cards = computed(() => summaryCards(info.value))
const banner = computed(() => serverBanner(info.value))
const shown = computed(() => matchValues(tab.value === 'Status' ? info.value.status : info.value.variables, search.value))
const tabs = computed(() => [
  { value: 'Overview', label: 'Overview' },
  { value: 'Variables', label: 'Variables', count: info.value?.variables.length ?? 0 },
  { value: 'Status', label: 'Status', count: info.value?.status.length ?? 0 },
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
          <div v-if="banner" class="si-banner">{{ banner }}</div>
        </template>

        <template v-else>
          <BaseInput v-model="search" :placeholder="`Search ${tab.toLowerCase()} by name or value…`" class="si-search" />
          <div v-if="!shown.length" class="si-empty">Nothing matches “{{ search }}”.</div>
          <table v-else class="si-table">
            <thead>
              <tr><th>Name</th><th>Value</th></tr>
            </thead>
            <tbody>
              <tr v-for="v in shown" :key="v.name">
                <td class="si-name">{{ v.name }}</td>
                <td class="si-set">{{ v.value }}</td>
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
/* Both lists run to hundreds of rows, so they scroll inside the modal rather than
   making the modal itself tall enough to lose its header. */
.si-table { width: 100%; border-collapse: collapse; font-size: 12.5px; display: block; max-height: 52vh; overflow-y: auto; }
.si-table th {
  position: sticky; top: 0; text-align: left; padding: 6px 8px; font-weight: 600;
  color: var(--text-dim); background: var(--bg-panel-2); border-bottom: 1px solid var(--border);
}
.si-table td { padding: 6px 8px; border-bottom: 1px solid var(--border-soft); vertical-align: top; user-select: text; }
.si-name { font-family: var(--mono); color: var(--text); }
.si-set { font-family: var(--mono); word-break: break-all; }
</style>
