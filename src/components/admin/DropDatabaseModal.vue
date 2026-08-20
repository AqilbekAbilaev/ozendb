<script setup>
import { ref } from 'vue'
import { dropDatabase } from '../../engines/mongodb/api/resources'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { useToast } from '../../composables/useToast'
import { closeWhere } from '../../stores/tabs'
import { affectedByResource } from '../../workspaces/lifecycle'
import { createResourceRef } from '../../utils/resourceRef'

// Database → Drop Database…: destructive, so it confirms first. Dropping also closes every
// open tab pointing into that database — those tabs can no longer resolve anything.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, dbName }
})
const emit = defineEmits(['close', 'saved'])

const { showToast } = useToast()

const error = ref(null)
const deleting = ref(false)

async function confirm() {
  if (deleting.value) return
  deleting.value = true
  error.value = null
  try {
    await dropDatabase({ connectionId: props.target.connId, database: props.target.dbName })
    // Containment closes every tab scoped into the dropped database (collections,
    // shells, tools), and only those; connection-scoped tabs like Current Operations
    // survive. closeTab runs disposal for each removed workspace.
    closeWhere(affectedByResource(createResourceRef(props.target.connId, [{ kind: 'database', name: props.target.dbName }])))
    showToast(`Database "${props.target.dbName}" dropped`)
    emit('saved', props.target.connId)
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
      <p>Are you sure you want to drop "<strong>{{ target.dbName }}</strong>"? This deletes all of its collections and cannot be undone.</p>
      <FieldError :text="error" spaced />
    </div>
    <div class="del-footer">
      <span class="spacer"></span>
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="danger" :disabled="deleting" @click="confirm">
        {{ deleting ? 'Dropping…' : 'Drop' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>
