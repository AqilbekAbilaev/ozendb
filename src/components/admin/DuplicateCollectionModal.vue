<script setup>
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import BaseModal from '../base/BaseModal.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { useToast } from '../../composables/useToast'

// Collection → Duplicate Collection…: copies every document into a new collection in the
// same database, prefilled with a "_copy" suffix. The backend returns the copied count.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, dbName, collName }
})
const emit = defineEmits(['close', 'saved'])

const { showToast } = useToast()

const name = ref(props.target.collName + '_copy')
const error = ref(null)
const saving = ref(false)

// Duplicating onto itself would fail server-side, so the button waits for a new name.
const valid = computed(() => {
  const next = name.value.trim()
  return !!next && next !== props.target.collName
})

async function confirm() {
  if (!valid.value || saving.value) return
  const targetName = name.value.trim()
  saving.value = true
  error.value = null
  try {
    const count = await invoke('duplicate_collection', {
      id: props.target.connId,
      database: props.target.dbName,
      source: props.target.collName,
      target: targetName,
    })
    showToast(`Copied ${count} document${count === 1 ? '' : 's'} to "${targetName}"`)
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
      <span class="spacer"></span>
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!valid || saving" @click="confirm">
        {{ saving ? 'Duplicating…' : 'Duplicate' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
