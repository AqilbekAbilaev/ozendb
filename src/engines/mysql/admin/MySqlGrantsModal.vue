<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { grants as listGrants, grantPrivileges, revokePrivileges } from '../api/admin'
import { GRANT_LEVELS, privilegesFor, privilegeChange } from './grantRows'
import { accountName } from './userRows'
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

// Grant or revoke one account's privileges on the server, a database or a table, under
// what it holds now as SHOW GRANTS states it. Opened from the Users modal's detail panel.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, user, host }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const statements = ref([])

async function load() {
  loading.value = true
  error.value = null
  try {
    statements.value = await listGrants(props.target.connId, props.target)
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const draft = reactive({ level: 'database', database: '', table: '', privileges: [], grantOption: false })
const levelOptions = GRANT_LEVELS.map(level => ({ value: level, label: level }))
const draftPrivileges = computed(() => privilegesFor(draft.level))
const busy = ref(false)
const actionError = ref(null)

function togglePrivilege(privilege, on) {
  draft.privileges = on ? [...draft.privileges, privilege] : draft.privileges.filter(p => p !== privilege)
}

async function apply(call, done) {
  const built = privilegeChange(props.target, draft)
  if (built.error) { actionError.value = built.error; return }
  busy.value = true
  actionError.value = null
  try {
    await call(props.target.connId, built.change)
    showToast(done)
    await load()
  } catch (e) {
    actionError.value = errText(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Grants — ${accountName(target)}`" width="min(860px, calc(100vw - 40px))" max-height="calc(100vh - 80px)" @close="$emit('close')">
    <!-- Only the list scrolls, under controls that stay put. -->
    <BaseModalBody :scrollable="false" class="mg-body">
      <div class="mg-form">
        <div class="mg-row">
          <BaseSelect v-model="draft.level" :options="levelOptions" />
          <BaseInput v-if="draft.level !== 'server'" v-model="draft.database" placeholder="database" />
          <BaseInput v-if="draft.level === 'table'" v-model="draft.table" placeholder="table" />
        </div>
        <div class="mg-row">
          <BaseCheckbox v-for="p in draftPrivileges" :key="p" :label="p" :model-value="draft.privileges.includes(p)" @update:model-value="togglePrivilege(p, $event)" />
        </div>
        <div class="mg-row">
          <BaseCheckbox v-model="draft.grantOption" title="Granting lets this account pass them on; revoking takes that away too" label="With grant option" />
          <span class="mg-spacer" />
          <BaseButton bordered :disabled="busy" @click="apply(revokePrivileges, 'Privileges revoked')">Revoke</BaseButton>
          <BaseButton bordered :disabled="busy" @click="apply(grantPrivileges, 'Privileges granted')">Grant</BaseButton>
        </div>
        <FieldError :text="actionError" spaced />
      </div>

      <HintText dim>What this account holds now, as MySQL states it — roles and column grants included.</HintText>

      <StateMessage v-if="loading" mode="loading" label="Loading grants…" />
      <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" />
      <div v-else class="mg-list">
        <pre v-for="s in statements" :key="s" class="mg-statement">{{ s }}</pre>
      </div>
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.mg-body { min-height: 0; }
.mg-form {
  flex: none; display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;
  padding: 10px; border: 1px solid var(--border-soft); border-radius: 7px;
}
.mg-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.mg-spacer { flex: 1; }
.mg-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.mg-statement {
  margin: 0; padding: 6px 10px; font-family: var(--mono); font-size: 11.5px; white-space: pre-wrap; word-break: break-word;
  color: var(--text); border: 1px solid var(--border-soft); border-radius: 7px; background: var(--bg-field); user-select: text;
}
</style>
