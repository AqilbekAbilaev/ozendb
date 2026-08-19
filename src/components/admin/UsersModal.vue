<script setup>
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listConnections } from '../../engines/mongodb/api/connections'
import { errText } from '../../utils/errors'
import { useConfirmDelete } from '../../composables/useConfirmDelete'
import BaseIcon from '../base/BaseIcon.vue'
import BaseSelect from '../base/BaseSelect.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import FieldError from '../base/FieldError.vue'
import HintText from '../base/HintText.vue'
import BaseModalBody from '../base/BaseModalBody.vue'
import FormField from '../base/FormField.vue'

// Manage Users for a database: list, create, and drop users (via usersInfo /
// createUser / dropUser).
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, dbName }
})
defineEmits(['close'])

const loading = ref(true)
const busy = ref(false)
const error = ref(null)
const users = ref([])
const { pendingId: pendingDrop, confirmDelete } = useConfirmDelete()

const showCreate = ref(false)
const newName = ref('')
const newPassword = ref('')
const newRoles = ref('read')   // comma-separated role names or role@db
const createError = ref(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    users.value = await invoke('list_users', { id: props.target.connId, database: props.target.dbName })
  } catch (e) {
    error.value = errText(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function createUser() {
  const name = newName.value.trim()
  if (!name || !newPassword.value) return
  const roles = newRoles.value.split(',').map(r => r.trim()).filter(Boolean)
  busy.value = true
  createError.value = null
  try {
    await invoke('create_user', {
      id: props.target.connId,
      database: props.target.dbName,
      username: name,
      password: newPassword.value,
      roles: roles,
    })
    showCreate.value = false
    newName.value = ''
    newPassword.value = ''
    newRoles.value = 'read'
    await load()
  } catch (e) {
    createError.value = errText(e)
  } finally {
    busy.value = false
  }
}

async function dropUser(user) {
  if (!confirmDelete(user.user)) return
  busy.value = true
  try {
    await invoke('drop_user', { id: props.target.connId, database: props.target.dbName, username: user.user })
    await load()
  } catch (e) {
    error.value = errText(e)
  } finally {
    busy.value = false
  }
}

// ── Copy users to another connection/database ───────────────────
// Passwords can't be transferred (MongoDB won't export a usable hash), so each copied
// user gets a generated temporary password that must be reset.
const showCopy = ref(false)
const connections = ref([])
const connOptions = computed(() => connections.value.map((c) => ({ value: c.id, label: c.name })))
const copyTargetConn = ref('')
const copyTargetDb = ref('')
const copying = ref(false)
const copyError = ref(null)
const copyResults = ref(null)  // [{ user, status, temp_password, roles, message }] | null

async function openCopyPanel() {
  showCopy.value = !showCopy.value
  if (!showCopy.value) return
  copyResults.value = null
  copyError.value = null
  copyTargetDb.value = props.target.dbName
  try {
    connections.value = await listConnections()
    copyTargetConn.value = props.target.connId
  } catch (e) {
    copyError.value = errText(e)
  }
}

async function runCopyUsers() {
  const targetDb = copyTargetDb.value.trim()
  if (!copyTargetConn.value || !targetDb) return
  copying.value = true
  copyError.value = null
  copyResults.value = null
  try {
    copyResults.value = await invoke('copy_users_to_connection', {
      sourceId: props.target.connId,
      sourceDatabase: props.target.dbName,
      targetId: copyTargetConn.value,
      targetDatabase: targetDb,
    })
  } catch (e) {
    copyError.value = errText(e)
  } finally {
    copying.value = false
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {})
}
</script>

<template>
  <BaseModal :title="`Users — ${target.dbName}`" width="660px" max-width="92vw" @close="$emit('close')">

      <BaseModalBody>
        <div class="um-bar">
          <BaseButton variant="primary" :disabled="busy" @click="showCreate = !showCreate">
            <BaseIcon name="plus" :size="12" /> Add User
          </BaseButton>
          <BaseButton bordered :active="showCopy" :disabled="busy || !users.length" @click="openCopyPanel">
            <BaseIcon name="export" :size="12" /> Copy Users To…
          </BaseButton>
        </div>

        <div v-if="showCopy" class="um-copy">
          <div class="um-copy-row">
            <FormField label="Target connection">
              <BaseSelect v-model="copyTargetConn" class="um-select" :options="connOptions" />
            </FormField>
          </div>
          <div class="um-copy-row">
            <FormField label="Target database">
              <BaseInput v-model="copyTargetDb" placeholder="database" />
            </FormField>
          </div>
          <HintText dim class="um-copy-note">
            Roles are copied as-is. Passwords can't be transferred — each user is created with a
            <strong>temporary password</strong> that must be reset.
          </HintText>
          <div class="um-create-actions">
            <BaseButton bordered @click="showCopy = false">Close</BaseButton>
            <BaseButton variant="primary" :disabled="!copyTargetConn || !copyTargetDb.trim() || copying" @click="runCopyUsers">
              {{ copying ? 'Copying…' : 'Copy Users' }}
            </BaseButton>
          </div>
          <FieldError :text="copyError" />

          <table v-if="copyResults" class="um-table um-copy-results">
            <thead>
              <tr><th>User</th><th>Status</th><th>Temporary password</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in copyResults" :key="r.user">
                <td>{{ r.user }}</td>
                <td :class="r.status === 'created' ? 'um-ok' : 'um-fail'">
                  {{ r.status === 'created' ? 'Created' : (r.message || 'Failed') }}
                </td>
                <td>
                  <BaseButton v-if="r.temp_password" size="sm" class="um-pw" title="Click to copy" @click="copyText(r.temp_password)">
                    {{ r.temp_password }} <BaseIcon name="copy" :size="11" />
                  </BaseButton>
                  <span v-else>—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <HintText dim v-if="copyResults && !copyResults.length" class="um-copy-note">No users to copy.</HintText>
        </div>

        <div v-if="showCreate" class="um-create">
          <BaseInput v-model="newName" placeholder="Username" />
          <BaseInput v-model="newPassword" type="password" placeholder="Password" />
          <BaseInput v-model="newRoles" placeholder="Roles (comma-separated, e.g. readWrite, read@other)" />
          <div class="um-create-actions">
            <BaseButton bordered @click="showCreate = false">Cancel</BaseButton>
            <BaseButton variant="primary" :disabled="!newName.trim() || !newPassword || busy" @click="createUser">Create</BaseButton>
          </div>
          <FieldError :text="createError" />
        </div>

        <StateMessage v-if="loading" mode="loading" label="Loading users…" />
        <StateMessage v-else-if="error" mode="error" :message="error" />
        <StateMessage v-else-if="!users.length" mode="empty" label="No users on this database" />
        <table v-else class="um-table">
          <thead>
            <tr><th>User</th><th>Database</th><th>Roles</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.user + '@' + u.db">
              <td>{{ u.user }}</td>
              <td>{{ u.db }}</td>
              <td class="um-roles">{{ u.roles.join(', ') || '—' }}</td>
              <td class="um-act">
                <BaseButton
                  bordered
                  :variant="pendingDrop === u.user ? 'danger' : 'default'"
                  :disabled="busy"
                  @click="dropUser(u)"
                >{{ pendingDrop === u.user ? 'Confirm' : 'Drop' }}</BaseButton>
              </td>
            </tr>
          </tbody>
        </table>
      </BaseModalBody>
    </BaseModal>
</template>

<style scoped>


.um-bar { display: flex; }
.um-create { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; }
.um-create-actions { display: flex; justify-content: flex-end; gap: 8px; }
.um-select { width: 100%; }

.um-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.um-table th { text-align: left; font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.um-table td { padding: 6px 8px; border-bottom: 1px solid var(--grid-line); color: var(--text); user-select: text; }
.um-roles { color: var(--text-dim); }
.um-act { text-align: right; }


.um-bar { gap: 8px; }
.um-copy { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; }
.um-copy-row { display: flex; align-items: center; gap: 10px; }
.um-copy-note { margin: 2px 0 0; }
.um-copy-note strong { color: var(--text); }
.um-copy-results { margin-top: 6px; }
.um-ok { color: var(--cell-str-green, var(--text)); }
.um-fail { color: var(--danger-text); }
.base-btn.um-pw {
  font-family: var(--mono); font-size: 11.5px; color: var(--text);
  background: var(--bg-window); border: 1px solid var(--border-soft); border-radius: 5px;
  padding: 3px 7px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
}
.base-btn.um-pw:hover { border-color: var(--accent); }
</style>
