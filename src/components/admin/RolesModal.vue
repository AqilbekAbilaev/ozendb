<script setup>
import { ref, onMounted } from 'vue'
import { listRoles } from '../../engines/mongodb/api/admin'
import { apiTarget } from '../../engines/mongodb/api/payload'
import { errText } from '../../utils/errors'
import StateMessage from '../base/StateMessage.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseModalBody from '../base/BaseModalBody.vue'
import { resourceName } from '../../utils/resourceRef'

// Manage Roles for a database: read-only listing of the custom (non-built-in) roles.
const props = defineProps({
  target: { type: Object, required: true },  // { resource, connectionName }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const roles = ref([])

onMounted(async () => {
  try {
    roles.value = await listRoles(apiTarget(props.target.resource))
  } catch (e) {
    error.value = errText(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <BaseModal :title="`Roles — ${resourceName(target.resource)}`" width="420px" max-width="92vw" @close="$emit('close')">
      <BaseModalBody>
        <StateMessage v-if="loading" mode="loading" label="Loading roles…" />
        <StateMessage v-else-if="error" mode="error" :message="error" />
        <StateMessage v-else-if="!roles.length" mode="empty" label="No custom roles on this database" />
        <ul v-else class="rm-list">
          <li v-for="r in roles" :key="r">{{ r }}</li>
        </ul>
      </BaseModalBody>
    </BaseModal>
</template>

<style scoped>

.rm-list { margin: 0; padding-left: 18px; font-size: 13px; color: var(--text); line-height: 1.7; user-select: text; }
</style>
