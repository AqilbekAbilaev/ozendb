<script setup>
import { ref } from 'vue'
import { dropCollection } from '../../engines/mongodb/api/resources'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { useToast } from '../../composables/useToast'
import { closeWhere } from '../../stores/tabs'
import { affectedByResource } from '../../workspaces/lifecycle'
import { createResourceRef } from '../../utils/resourceRef'

// Collection → Drop Collection…: destructive, so it confirms first. Dropping also closes
// any open tab on that collection, which would otherwise query something gone.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, dbName, collName }
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
    await dropCollection({
      connectionId: props.target.connId,
      database:     props.target.dbName,
      collection:   props.target.collName,
    })
    // Containment closes every tab scoped into the dropped collection (find/aggregate/
    // SQL/import/export/indexes/schema), and only those. closeTab runs disposal.
    closeWhere(affectedByResource(createResourceRef(props.target.connId, [
      { kind: 'database', name: props.target.dbName },
      { kind: 'collection', name: props.target.collName },
    ])))
    showToast(`Collection "${props.target.collName}" dropped`)
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
  <BaseModal title="Drop Collection" @close="emit('close')">
    <div class="del-body">
      <p>Are you sure you want to drop "<strong>{{ target.collName }}</strong>"? This deletes all of its documents and cannot be undone.</p>
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
