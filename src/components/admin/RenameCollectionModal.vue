<script setup>
import { ref, computed } from 'vue'
import { renameCollection } from '../../engines/mongodb/api/resources'
import BaseModal from '../base/BaseModal.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { useToast } from '../../composables/useToast'
import { tabs } from '../../stores/tabs'

// Collection → Rename Collection…: prefilled with the current name. An open tab on the
// collection is retitled in place rather than closed, so the user keeps their query.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, dbName, collName }
})
const emit = defineEmits(['close', 'saved'])

const { showToast } = useToast()

const name = ref(props.target.collName)
const error = ref(null)
const saving = ref(false)

// Renaming to the same name is a no-op, so the button stays disabled until it differs.
const valid = computed(() => {
  const next = name.value.trim()
  return !!next && next !== props.target.collName
})

async function confirm() {
  if (!valid.value || saving.value) return
  const newName = name.value.trim()
  saving.value = true
  error.value = null
  try {
    await renameCollection(
      { connectionId: props.target.connId, database: props.target.dbName, collection: props.target.collName },
      newName,
    )
    const open = tabs.value.find(t => t.kind === 'collection'
      && t.connectionId === props.target.connId
      && t.dbName === props.target.dbName
      && t.collectionName === props.target.collName)
    if (open) {
      open.collectionName = newName
      open.title = newName
    }
    showToast(`Collection renamed to "${newName}"`)
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
  <BaseModal title="Rename Collection" @close="emit('close')">
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
        {{ saving ? 'Renaming…' : 'Rename' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
