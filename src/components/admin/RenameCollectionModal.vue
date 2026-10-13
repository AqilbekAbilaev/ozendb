<script setup>
import { ref, computed } from 'vue'
import { renameCollection } from '../../engines/mongodb/api/resources'
import { apiTarget } from '../../engines/mongodb/api/payload'
import BaseModal from '../base/BaseModal.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { showToast } from '../../stores/toast'
import { invalidateConnectionResources } from '../../stores/connectionData'
import { tabs } from '../../stores/tabs'
import { retargetResource } from '../../workspaces/lifecycle'
import { createResourceRef, resourceKind, resourceName } from '../../utils/resourceRef'
import FlexSpacer from '../base/FlexSpacer.vue'

// Collection → Rename Collection…: prefilled with the current name. Open workspaces on
// the collection are retargeted in place rather than closed, so the user keeps their work.
const props = defineProps({
  target: { type: Object, required: true },   // { resource, connectionName }
})
const emit = defineEmits(['close'])


const current = props.target.resource
const name = ref(resourceName(current))
const error = ref(null)
const saving = ref(false)

// Renaming to the same name is a no-op, so the button stays disabled until it differs.
const valid = computed(() => {
  const next = name.value.trim()
  return !!next && next !== resourceName(current)
})

async function confirm() {
  if (!valid.value || saving.value) return
  const newName = name.value.trim()
  saving.value = true
  error.value = null
  try {
    await renameCollection(apiTarget(current), newName)
    // Every workspace on the old collection follows the rename — not just the first find
    // tab — so a later drop still recognises the tab (see workspaces/lifecycle). The new
    // reference is this one with its last segment renamed.
    const renamed = createResourceRef(current.connectionId, [
      ...current.segments.slice(0, -1),
      { kind: resourceKind(current), name: newName },
    ])
    tabs.value.forEach(retargetResource(current, renamed))
    showToast(`Collection renamed to "${newName}"`)
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
      <FlexSpacer />
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="primary" :disabled="!valid || saving" @click="confirm">
        {{ saving ? 'Renaming…' : 'Rename' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
