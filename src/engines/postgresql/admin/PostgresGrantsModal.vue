<script setup>
import { ref, computed, onMounted } from 'vue'
import { grants as listGrants } from '../api/admin'
import { errText, errCode } from '../../../utils/errors'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import HintText from '../../../components/base/HintText.vue'

// Read-only "what can this role touch" (ozendb-ahy): every schema/table/view/
// sequence this role holds a direct privilege on. Opened from the Roles modal's
// detail panel. Per-object GRANT/REVOKE itself is a separate, larger surface —
// see grants.rs's own doc comment for why this view alone is what shipped first.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, role }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const all = ref([])

async function load() {
  loading.value = true
  error.value = null
  try {
    all.value = await listGrants(props.target.connId, props.target.role)
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// Grouped by schema, then by object (null = the schema itself) — one row per
// object with its privileges joined, not one row per privilege.
const grouped = computed(() => {
  const bySchema = new Map()
  for (const g of all.value) {
    if (!bySchema.has(g.schema)) bySchema.set(g.schema, new Map())
    const objects = bySchema.get(g.schema)
    const key = g.object ?? ''
    if (!objects.has(key)) objects.set(key, { object: g.object, objectKind: g.objectKind, privileges: [] })
    objects.get(key).privileges.push(g.privilege)
  }
  return [...bySchema.entries()].map(([schema, objects]) => ({ schema, objects: [...objects.values()] }))
})
</script>

<template>
  <BaseModal :title="`Grants — ${target.role}`" width="600px" max-width="calc(100vw - 40px)" height="calc(100vh - 80px)" max-height="calc(100vh - 80px)" @close="$emit('close')">
    <BaseModalBody>
      <HintText dim>Direct privileges only — not what this role inherits through group membership.</HintText>

      <StateMessage v-if="loading" mode="loading" label="Loading grants…" />
      <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" />
      <StateMessage v-else-if="!grouped.length" mode="empty" label="This role has no direct privilege on anything." />
      <div v-else class="pg-list">
        <div v-for="entry in grouped" :key="entry.schema" class="pg-schema">
          <div class="pg-schema-name">{{ entry.schema }}</div>
          <div v-for="obj in entry.objects" :key="obj.object ?? ''" class="pg-item">
            <code class="pg-obj">{{ obj.object ? `${obj.objectKind}: ${obj.object}` : 'schema' }}</code>
            <span class="pg-privs">{{ obj.privileges.join(', ') }}</span>
          </div>
        </div>
      </div>
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.pg-list { display: flex; flex-direction: column; gap: 14px; }
.pg-schema-name { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.pg-item {
  display: flex; align-items: center; gap: 12px; margin-left: 10px;
  padding: 6px 10px; border: 1px solid var(--border-soft); border-radius: 7px;
  background: var(--bg-field);
}
.pg-obj { flex: none; font-family: var(--mono); font-size: 12px; color: var(--text-dim); }
.pg-privs { flex: 1; min-width: 0; font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
