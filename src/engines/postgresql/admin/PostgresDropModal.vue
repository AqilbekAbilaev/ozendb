<script setup>
import { ref, computed } from 'vue'
import { dropSchema, dropTable } from '../api/ddl'
import { pgNodeRef } from '../tree/nodeRef'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseCheckbox from '../../../components/base/BaseCheckbox.vue'
import FieldError from '../../../components/base/FieldError.vue'
import { errText } from '../../../utils/errors'
import { showToast } from '../../../stores/toast'
import { invalidateConnectionResources } from '../../../stores/connectionData'
import { closeWhere } from '../../../stores/tabs'
import { affectedByResource } from '../../../workspaces/lifecycle'

// Schema or table → Drop…: the node's depth says which. Dropping closes every tab
// inside it, which would otherwise query something gone.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, database, schema, table? }
})
const emit = defineEmits(['close'])

const isTable = computed(() => props.target.table != null)
const name = computed(() => isTable.value ? props.target.table : props.target.schema)
const cascade = ref(false)
const error = ref(null)
const dropping = ref(false)

async function confirm() {
  if (dropping.value) return
  dropping.value = true
  error.value = null
  const { connId, schema, table } = props.target
  try {
    if (isTable.value) await dropTable({ connectionId: connId, schema, table }, cascade.value)
    else await dropSchema(connId, schema, cascade.value)
    invalidateConnectionResources(connId)
    closeWhere(affectedByResource(pgNodeRef(props.target)))
    showToast(`${isTable.value ? 'Table' : 'Schema'} "${name.value}" dropped`)
    emit('close')
  } catch (e) {
    error.value = errText(e)
  } finally {
    dropping.value = false
  }
}
</script>

<template>
  <BaseModal :title="isTable ? 'Drop Table' : 'Drop Schema'" @close="emit('close')">
    <div class="del-body">
      <p v-if="isTable">Are you sure you want to drop "<strong>{{ name }}</strong>"? This deletes all of its rows and cannot be undone.</p>
      <p v-else>Are you sure you want to drop the schema "<strong>{{ name }}</strong>"? This cannot be undone.</p>
      <label class="cascade">
        <BaseCheckbox v-model="cascade" />
        {{ isTable ? 'Also drop views and foreign keys that depend on it (CASCADE)' : 'Also drop every table and object in it (CASCADE)' }}
      </label>
      <FieldError :text="error" spaced />
    </div>
    <div class="del-footer">
      <span class="spacer"></span>
      <BaseButton @click="emit('close')">Cancel</BaseButton>
      <BaseButton variant="danger" :disabled="dropping" @click="confirm">
        {{ dropping ? 'Dropping…' : 'Drop' }}
      </BaseButton>
    </div>
  </BaseModal>
</template>

<style scoped>
.cascade { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
</style>
