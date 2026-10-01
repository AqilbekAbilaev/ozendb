<script setup>
import { ref, computed } from 'vue'
import { createSchema } from '../api/ddl'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import FieldError from '../../../components/base/FieldError.vue'
import { errText } from '../../../utils/errors'
import { showToast } from '../../../stores/toast'
import { invalidateConnectionResources } from '../../../stores/connectionData'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

const props = defineProps({
  target: { type: Object, required: true },   // { connId, database }
})
const emit = defineEmits(['close'])

const name = ref('')
const error = ref(null)
const saving = ref(false)
const valid = computed(() => !!name.value.trim())

async function confirm() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = null
  try {
    await createSchema(props.target.connId, name.value.trim())
    invalidateConnectionResources(props.target.connId)
    showToast(`Schema "${name.value.trim()}" created`)
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal title="Create Schema" @close="emit('close')">
    <div class="del-body">
      <BaseInput v-model="name" class="prompt-input" placeholder="Schema name" @keydown.enter="confirm" />
      <FieldError :text="error" spaced />
    </div>
    <div class="del-footer">
      <FlexSpacer />
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!valid || saving" @click="confirm">
        {{ saving ? 'Creating…' : 'Create' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
