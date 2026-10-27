<script setup>
import { ref, onMounted } from 'vue'
import { showDefinition } from '../api/resources'
import { errText } from '../../../utils/errors'
import { resourceName, segmentName } from '../../../utils/resourceRef'
import { openMySqlQuery } from '../tabs'
import { showToast } from '../../../stores/toast'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import CodeEditor from '../../../components/base/CodeEditor.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// Opened from a view's or stored program's sidebar row. Read-only, as PostgreSQL's
// routine browser is: the server's own CREATE statement, which a SQL tab can change.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, resource, kind }
})
defineEmits(['close'])

const database = segmentName(props.target.resource, 'database')
const name = resourceName(props.target.resource)
const loading = ref(true)
const error = ref(null)
const definition = ref('')

onMounted(async () => {
  try {
    definition.value = await showDefinition({ connectionId: props.target.connId, database }, props.target.kind, name)
  } catch (e) {
    error.value = errText(e)
  } finally {
    loading.value = false
  }
})

function copyDefinition() {
  navigator.clipboard.writeText(definition.value)
    .then(() => showToast('Definition copied'))
    .catch(() => showToast('Copy to clipboard failed'))
}

function openInSqlTab() {
  openMySqlQuery({ resource: props.target.resource, connectionName: props.target.connName, sql: definition.value })
}
</script>

<template>
  <BaseModal :title="`${name} — ${database}`" width="760px" max-width="95vw" @close="$emit('close')">
    <BaseModalBody>
      <div class="md-bar">
        <span class="md-kind">{{ target.kind }}</span>
        <FlexSpacer />
        <BaseButton variant="ghost" icon="copy" :disabled="!definition" @click="copyDefinition">Copy definition</BaseButton>
        <BaseButton variant="primary" icon="sql" :disabled="!definition" @click="openInSqlTab">Open in SQL tab</BaseButton>
      </div>
      <StateMessage v-if="loading" mode="loading" :label="`Reading the ${target.kind}'s definition…`" />
      <StateMessage v-else-if="error" mode="error" :message="error" />
      <CodeEditor v-else :model-value="definition" readonly language="sql" class="md-code" />
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.md-bar { display: flex; align-items: center; gap: 6px; margin: 12px 0 8px; }
.md-kind { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }
.md-code { height: 50vh; border: 1px solid var(--border); border-radius: 6px; }
</style>
