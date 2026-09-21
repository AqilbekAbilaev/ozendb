<script setup>
import { ref } from 'vue'
import { createCollection } from '../../engines/mongodb/api/resources'
import BaseModal from '../base/BaseModal.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { showToast } from '../../stores/toast'
import { invalidateConnectionResources } from '../../stores/connectionData'

// Database → Add GridFS Bucket…: a bucket is the pair of `<name>.files` and
// `<name>.chunks` collections; create both so it appears in the GridFS view.
const props = defineProps({
  target: { type: Object, required: true },   // { connectionId, connectionName, dbName }
})
const emit = defineEmits(['close'])


const name = ref('')
const error = ref(null)
const saving = ref(false)

async function confirm() {
  const bucket = name.value.trim()
  if (!bucket || saving.value) return
  saving.value = true
  error.value = null
  try {
    for (const suffix of ['files', 'chunks']) {
      await createCollection(
        { connectionId: props.target.connectionId, database: props.target.dbName },
        `${bucket}.${suffix}`,
      )
      // The first collection may succeed even if creating the second fails.
      invalidateConnectionResources(props.target.connectionId)
    }
    showToast(`GridFS bucket "${bucket}" created`)
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal title="Add GridFS Bucket" @close="emit('close')">
    <div class="del-body">
      <BaseInput
        v-model="name"
        class="prompt-input"
        placeholder="Bucket name (e.g. fs)"
        @keydown.enter="confirm"
      />
      <FieldError :text="error" spaced />
    </div>
    <div class="del-footer">
      <span class="spacer"></span>
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!name.trim() || saving" @click="confirm">
        {{ saving ? 'Creating…' : 'Create' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
