<script setup>
import { ref, computed } from 'vue'
import { renameCollection } from '../../engines/mongodb/api/resources'
import BaseModal from '../base/BaseModal.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { useToast } from '../../composables/useToast'
import { invalidateConnectionResources } from '../../stores/connectionData'
import { tabs } from '../../stores/tabs'
import { retargetResource } from '../../workspaces/lifecycle'
import { createResourceRef } from '../../utils/resourceRef'

// Collection → Rename Collection…: prefilled with the current name. Open workspaces on
// the collection are retargeted in place rather than closed, so the user keeps their work.
const props = defineProps({
  target: { type: Object, required: true },   // { connectionId, connectionName, dbName, collectionName }
})
const emit = defineEmits(['close'])

const { showToast } = useToast()

const name = ref(props.target.collectionName)
const error = ref(null)
const saving = ref(false)

// Renaming to the same name is a no-op, so the button stays disabled until it differs.
const valid = computed(() => {
  const next = name.value.trim()
  return !!next && next !== props.target.collectionName
})

async function confirm() {
  if (!valid.value || saving.value) return
  const newName = name.value.trim()
  saving.value = true
  error.value = null
  try {
    await renameCollection(
      { connectionId: props.target.connectionId, database: props.target.dbName, collection: props.target.collectionName },
      newName,
    )
    // Every workspace on the old collection follows the rename — not just the first
    // find tab. Retargeting keeps `target` in step with the flat fields, so a later
    // drop still recognises the tab (see workspaces/lifecycle).
    const at = (name) => createResourceRef(props.target.connectionId, [
      { kind: 'database', name: props.target.dbName },
      { kind: 'collection', name: name },
    ])
    tabs.value.forEach(retargetResource(at(props.target.collectionName), at(newName)))
    showToast(`Collection renamed to "${newName}"`)
    invalidateConnectionResources(props.target.connectionId)
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
