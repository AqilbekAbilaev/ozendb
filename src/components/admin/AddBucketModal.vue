<script setup>
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import BaseModal from '../base/BaseModal.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { useToast } from '../../composables/useToast'

// Database → Add GridFS Bucket…: a bucket is the pair of `<name>.files` and
// `<name>.chunks` collections; create both so it appears in the GridFS view.
//
// Owns its form state (name / error / saving) rather than borrowing refs from a
// composable — the dialog is the only thing that reads them. `saved` asks the caller to
// refresh the connection's tree, which is App.vue's to do.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, dbName }
})
const emit = defineEmits(['close', 'saved'])

const { showToast } = useToast()

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
      await invoke('create_collection', {
        id: props.target.connId,
        database: props.target.dbName,
        name: `${bucket}.${suffix}`,
      })
    }
    showToast(`GridFS bucket "${bucket}" created`)
    emit('saved', props.target.connId)
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

<style src="../../App.css" scoped></style>
