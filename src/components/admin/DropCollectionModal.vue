<script setup>
import { ref } from 'vue'
import { dropCollection } from '../../engines/mongodb/api/resources'
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

// Collection → Drop Collection…: destructive, so it confirms first. Dropping also closes
// any open tab on that collection, which would otherwise query something gone.
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
  const dropped = props.target.resource
  try {
    await dropCollection(apiTarget(dropped))
    invalidateConnectionResources(dropped.connectionId)
    // Containment closes every tab scoped into the dropped collection (find/aggregate/
    // SQL/import/export/indexes/schema), and only those. closeTab runs disposal.
    closeWhere(affectedByResource(dropped))
    clearTreeSelectionUnder(dropped)
    showToast(`Collection "${resourceName(dropped)}" dropped`)
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
      <p>Are you sure you want to drop "<strong>{{ resourceName(target.resource) }}</strong>"? This deletes all of its documents and cannot be undone.</p>
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
