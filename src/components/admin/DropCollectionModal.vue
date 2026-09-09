<script setup>
import { ref } from 'vue'
import { dropCollection } from '../../engines/mongodb/api/resources'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { useToast } from '../../composables/useToast'
import { invalidateConnectionResources } from '../../stores/connectionData'
import { closeWhere } from '../../stores/tabs'
import { affectedByResource } from '../../workspaces/lifecycle'
import { createResourceRef } from '../../utils/resourceRef'

// Collection → Drop Collection…: destructive, so it confirms first. Dropping also closes
// any open tab on that collection, which would otherwise query something gone.
const props = defineProps({
  target: { type: Object, required: true },   // { connectionId, connectionName, dbName, collectionName }
})
const emit = defineEmits(['close'])

const { showToast } = useToast()

const error = ref(null)
const deleting = ref(false)

async function confirm() {
  if (deleting.value) return
  deleting.value = true
  error.value = null
  try {
    await dropCollection({
      connectionId: props.target.connectionId,
      database:     props.target.dbName,
      collection:   props.target.collectionName,
    })
    invalidateConnectionResources(props.target.connectionId)
    // Containment closes every tab scoped into the dropped collection (find/aggregate/
    // SQL/import/export/indexes/schema), and only those. closeTab runs disposal.
    closeWhere(affectedByResource(createResourceRef(props.target.connectionId, [
      { kind: 'database', name: props.target.dbName },
      { kind: 'collection', name: props.target.collectionName },
    ])))
    showToast(`Collection "${props.target.collectionName}" dropped`)
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
      <p>Are you sure you want to drop "<strong>{{ target.collectionName }}</strong>"? This deletes all of its documents and cannot be undone.</p>
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
