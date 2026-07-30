<script setup>
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import FieldError from '../base/FieldError.vue'
import { errText } from '../../utils/errors'
import { useToast } from '../../composables/useToast'
import { tabs, pruneActiveTab } from '../../stores/tabs'

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
    await invoke('drop_collection', {
      id: props.target.connId,
      database: props.target.dbName,
      collection: props.target.collName,
    })
    tabs.value = tabs.value.filter(t => !(t.kind === 'collection'
      && t.connectionId === props.target.connId
      && t.dbName === props.target.dbName
      && t.collectionName === props.target.collName))
    pruneActiveTab()
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
