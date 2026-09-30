<script setup>
import { ref, computed } from 'vue'
import { renameTable } from '../api/ddl'
import { pgNodeRef } from '../tree/nodeRef'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import FieldError from '../../../components/base/FieldError.vue'
import { errText } from '../../../utils/errors'
import { showToast } from '../../../stores/toast'
import { invalidateConnectionResources } from '../../../stores/connectionData'
import { tabs } from '../../../stores/tabs'
import { retargetResource } from '../../../workspaces/lifecycle'

// Table → Rename Table…: open tabs on the table follow it rather than close, so the
// user keeps their filters and SQL.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, database, schema, table }
})
const emit = defineEmits(['close'])

const name = ref(props.target.table)
const error = ref(null)
const saving = ref(false)

const valid = computed(() => {
  const next = name.value.trim()
  return !!next && next !== props.target.table
})

async function confirm() {
  if (!valid.value || saving.value) return
  const newName = name.value.trim()
  saving.value = true
  error.value = null
  const { connId, schema, table } = props.target
  try {
    await renameTable({ connectionId: connId, schema, table }, newName)
    tabs.value.forEach(retargetResource(pgNodeRef(props.target), pgNodeRef({ ...props.target, table: newName })))
    invalidateConnectionResources(connId)
    showToast(`Table renamed to "${newName}"`)
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal title="Rename Table" @close="emit('close')">
    <div class="del-body">
      <BaseInput v-model="name" class="prompt-input" placeholder="New table name" @keydown.enter="confirm" />
      <FieldError :text="error" spaced />
    </div>
    <div class="del-footer">
      <span class="spacer"></span>
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!valid || saving" @click="confirm">
        {{ saving ? 'Renaming…' : 'Rename' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
