<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { grants as listGrants, grantPrivileges, revokePrivileges } from '../api/admin'
import { GRANT_KINDS, privilegesFor, groupGrants, revokeChange, grantChange } from './grantRows'
import { errText, errCode } from '../../../utils/errors'
import { showToast } from '../../../stores/toast'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseSelect from '../../../components/base/BaseSelect.vue'
import BaseCheckbox from '../../../components/base/BaseCheckbox.vue'
import FieldError from '../../../components/base/FieldError.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import HintText from '../../../components/base/HintText.vue'

// What this role can touch, and GRANT/REVOKE on schemas, tables and sequences
// (ozendb-ahy). Opened from the Roles modal's detail panel.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, role }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const all = ref([])
const grouped = computed(() => groupGrants(all.value))

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

const draft = reactive({ kind: 'table', schema: 'public', object: '', privileges: [], grantOption: false })
const kindOptions = GRANT_KINDS.map(k => ({ value: k, label: k }))
const draftPrivileges = computed(() => privilegesFor(draft.kind))
const cascade = ref(false)
const busy = ref(false)
const actionError = ref(null)

function togglePrivilege(privilege, on) {
  draft.privileges = on ? [...draft.privileges, privilege] : draft.privileges.filter(p => p !== privilege)
}

async function apply(call, change, done) {
  busy.value = true
  actionError.value = null
  try {
    await call(props.target.connId, change)
    showToast(done)
    await load()
  } catch (e) {
    actionError.value = errText(e)
  } finally {
    busy.value = false
  }
}

function grant() {
  const built = grantChange(props.target.role, draft)
  if (built.error) { actionError.value = built.error; return }
  apply(grantPrivileges, built.change, 'Privileges granted')
}

function revoke(schema, obj) {
  apply(revokePrivileges, revokeChange(props.target.role, schema, obj, cascade.value), 'Privileges revoked')
}
</script>

<template>
  <BaseModal :title="`Grants — ${target.role}`" width="min(860px, calc(100vw - 40px))" max-height="calc(100vh - 80px)" @close="$emit('close')">
    <!-- Only the list scrolls, under controls that stay put (#176). -->
    <BaseModalBody :scrollable="false" class="pg-body">
      <div class="pg-grant-form">
        <div class="pg-grant-row">
          <BaseSelect v-model="draft.kind" :options="kindOptions" />
          <BaseInput v-model="draft.schema" placeholder="schema" />
          <BaseInput v-if="draft.kind !== 'schema'" v-model="draft.object" :placeholder="`${draft.kind} name`" />
        </div>
        <div class="pg-grant-row">
          <BaseCheckbox v-for="p in draftPrivileges" :key="p" :label="p" :model-value="draft.privileges.includes(p)" @update:model-value="togglePrivilege(p, $event)" />
        </div>
        <div class="pg-grant-row">
          <BaseCheckbox v-model="draft.grantOption" label="With grant option" />
          <BaseCheckbox v-model="cascade" title="Also revoke what this role granted onward" label="Revoke with CASCADE" />
          <BaseButton class="pg-grant-btn" bordered :disabled="busy" @click="grant">Grant</BaseButton>
        </div>
        <FieldError :text="actionError" spaced />
      </div>

      <HintText dim>Direct privileges only — not what this role inherits through group membership.</HintText>

      <StateMessage v-if="loading" mode="loading" label="Loading grants…" />
      <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" />
      <StateMessage v-else-if="!grouped.length" mode="empty" label="This role has no direct privilege on anything." />
      <div v-else class="pg-list">
        <div v-for="entry in grouped" :key="entry.schema" class="pg-schema">
          <div class="pg-schema-name">{{ entry.schema }}</div>
          <div v-for="obj in entry.objects" :key="obj.object ?? ''" class="pg-item">
            <code class="pg-obj">{{ obj.object ? `${obj.objectKind}: ${obj.object}` : 'schema' }}</code>
            <span class="pg-privs" :title="obj.privileges.join(', ')">{{ obj.privileges.join(', ') }}</span>
            <BaseButton size="sm" :disabled="busy" title="Revoke these privileges" @click="revoke(entry.schema, obj)">Revoke</BaseButton>
          </div>
        </div>
      </div>
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.pg-body { min-height: 0; }
.pg-grant-form {
  flex: none; display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;
  padding: 10px; border: 1px solid var(--border-soft); border-radius: 7px;
}
.pg-grant-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.pg-grant-btn { margin-left: auto; }
.pg-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
.pg-schema-name { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.pg-item {
  display: flex; align-items: center; gap: 12px; margin-left: 10px;
  padding: 6px 10px; border: 1px solid var(--border-soft); border-radius: 7px;
  background: var(--bg-field);
}
.pg-obj { flex: none; font-family: var(--mono); font-size: 12px; color: var(--text-dim); }
.pg-privs { flex: 1; min-width: 0; font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
