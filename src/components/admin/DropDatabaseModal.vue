<script setup>
import { ref } from 'vue'
import { dropDatabase } from '../../engines/mongodb/api/resources'
import { apiTarget } from '../../engines/mongodb/api/payload'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { showToast } from '../../stores/toast'
import { invalidateConnectionResources } from '../../stores/connectionData'
import { closeWhere } from '../../stores/tabs'
import { clearTreeSelectionUnder } from '../../stores/connectionNavigation'
import { affectedByResource } from '../../workspaces/lifecycle'
import { resourceName } from '../../utils/resourceRef'
import FlexSpacer from '../base/FlexSpacer.vue'

// Database → Drop Database…: destructive, so it confirms first. Dropping also closes every
// open tab pointing into that database — those tabs can no longer resolve anything.
const props = defineProps({
  target: { type: Object, required: true },   // { resource, connectionName }
})
const emit = defineEmits(['close'])


const error = ref(null)
const deleting = ref(false)

async function confirm() {
  if (deleting.value) return
  deleting.value = true
  error.value = null
  try {
    await dropDatabase(apiTarget(props.target.resource))
    invalidateConnectionResources(props.target.resource.connectionId)
    // Containment closes every tab scoped into the dropped database (collections,
    // shells, tools), and only those; connection-scoped tabs like Current Operations
    // survive. closeTab runs disposal for each removed workspace.
    closeWhere(affectedByResource(props.target.resource))
    clearTreeSelectionUnder(props.target.resource)
    showToast(`Database "${resourceName(props.target.resource)}" dropped`)
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <BaseModal title="Drop Database" @close="emit('close')">
    <div class="del-body">
      <p>Are you sure you want to drop "<strong>{{ resourceName(target.resource) }}</strong>"? This deletes all of its collections and cannot be undone.</p>
      <FieldError :text="error" spaced />
    </div>
    <div class="del-footer">
      <FlexSpacer />
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="danger" :disabled="deleting" @click="confirm">
        {{ deleting ? 'Dropping…' : 'Drop' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
