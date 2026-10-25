<script setup>
import { ref, computed } from 'vue'
import { duplicateCollection } from '../api/transfer'
import { apiTarget } from '../api/payload'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import FieldError from '../../../components/base/FieldError.vue'
import { errText } from '../../../utils/errors'
import { showToast } from '../../../stores/toast'
import { invalidateConnectionResources } from '../../../stores/connectionData'
import { resourceName } from '../../../utils/resourceRef'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// Collection → Duplicate Collection…: copies every document into a new collection in the
// same database, prefilled with a "_copy" suffix. The backend returns the copied count.
const props = defineProps({
  target: { type: Object, required: true },   // { resource, connectionName }
})
const emit = defineEmits(['close'])


const current = props.target.resource
const name = ref(resourceName(current) + '_copy')
const error = ref(null)
const saving = ref(false)

// Duplicating onto itself would fail server-side, so the button waits for a new name.
const valid = computed(() => {
  const next = name.value.trim()
  return !!next && next !== resourceName(current)
})

async function confirm() {
  if (!valid.value || saving.value) return
  const targetName = name.value.trim()
  saving.value = true
  error.value = null
  try {
    const count = await duplicateCollection(apiTarget(current), targetName)
    showToast(`Copied ${count} document${count === 1 ? '' : 's'} to "${targetName}"`)
    invalidateConnectionResources(current.connectionId)
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal title="Duplicate Collection" @close="emit('close')">
    <div class="del-body">
      <BaseInput
        v-model="name"
        class="prompt-input"
        placeholder="New collection name"
        @keydown.enter="confirm"
      />
      <FieldError :text="error" spaced />
    </div>
    <div class="del-footer">
      <FlexSpacer />
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!valid || saving" @click="confirm">
        {{ saving ? 'Duplicating…' : 'Duplicate' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
