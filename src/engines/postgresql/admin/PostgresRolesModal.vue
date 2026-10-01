<script setup>
import { ref, computed, onMounted } from 'vue'
import { roles as listRoles, createRole, dropRole } from '../api/admin'
import { errText, errCode } from '../../../utils/errors'
import { roleAttributes, matchRoles, membersOf, canDropRole } from './roleRows'
import { openConnections } from '../../../stores/openConnections'
import { showToast } from '../../../stores/toast'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseCheckbox from '../../../components/base/BaseCheckbox.vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// Opened from a PostgreSQL connection's right-click menu. Roles are cluster-wide in
// Postgres, so this is a server-level view, not a per-database one. Per-object
// GRANT/REVOKE is deliberately not here — a much larger surface, tracked separately.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, … }
})
defineEmits(['close'])

const BLANK = { name: '', password: '', canLogin: true, superuser: false, createDb: false, createRole: false }

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const all = ref([])
const filters = ref({ search: '', showSystem: false, loginOnly: false })
const selected = ref(null)
const adding = ref(false)
const draft = ref({ ...BLANK })
const saving = ref(false)
const formError = ref(null)
const confirming = ref(null)

// The role this connection is logged in as — it can't drop itself.
const currentUser = computed(() =>
  openConnections.value.find(c => c.id === props.target.connId)?.username ?? null)
const readOnly = computed(() =>
  !!openConnections.value.find(c => c.id === props.target.connId)?.read_only)

async function load() {
  try {
    all.value = await listRoles(props.target.connId)
    error.value = null
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

const shown = computed(() => matchRoles(all.value, filters.value))
const members = computed(() => (selected.value ? membersOf(all.value, selected.value.name) : []))
const dropCheck = computed(() => (selected.value ? canDropRole(selected.value, currentUser.value) : { ok: false }))

async function save() {
  if (saving.value) return
  saving.value = true
  formError.value = null
  try {
    await createRole(props.target.connId, {
      name: draft.value.name.trim(),
      // An empty box means no password, which Postgres stores as PASSWORD NULL —
      // distinct from a role with a password nobody knows.
      password: draft.value.password ? draft.value.password : null,
      canLogin: draft.value.canLogin,
      superuser: draft.value.superuser,
      createDb: draft.value.createDb,
      createRole: draft.value.createRole,
    })
    showToast(`Role ${draft.value.name.trim()} created`)
    adding.value = false
    draft.value = { ...BLANK }
    await load()
  } catch (e) {
    formError.value = errText(e)
  } finally {
    saving.value = false
  }
}

async function confirmDrop() {
  const name = confirming.value.name
  try {
    await dropRole(props.target.connId, name)
    showToast(`Role ${name} dropped`)
    if (selected.value?.name === name) selected.value = null
    await load()
  } catch (e) {
    // Postgres names what the role still owns; that detail is the useful part.
    showToast(errText(e))
  } finally {
    confirming.value = null
  }
}
</script>

<template>
  <BaseModal :title="`Roles — ${target.connName}`" width="940px" max-width="95vw" @close="$emit('close')">
    <BaseModalBody>
      <StateMessage v-if="loading" mode="loading" label="Reading roles…" />
      <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" retryable @retry="load" />
      <template v-else>
        <div class="pr-bar">
          <BaseInput v-model="filters.search" placeholder="Search a role, or a group to see who is in it…" class="pr-search" />
          <BaseButton bordered :active="filters.loginOnly" @click="filters.loginOnly = !filters.loginOnly">Can log in</BaseButton>
          <BaseButton bordered :active="filters.showSystem" title="PostgreSQL's own predefined roles" @click="filters.showSystem = !filters.showSystem">
            System
          </BaseButton>
          <FlexSpacer />
          <span class="pr-count">{{ shown.length }} of {{ all.length }}</span>
          <BaseButton
            variant="primary"
            icon="plus"
            :disabled="readOnly"
            :title="readOnly ? 'This connection is read-only' : 'Create a role'"
            @click="adding = true; formError = null"
          >New role</BaseButton>
        </div>

        <div class="pr-split">
          <div class="pr-list">
            <div v-if="!shown.length" class="pr-empty">No role matches.</div>
            <div
              v-for="role in shown"
              :key="role.name"
              class="pr-item"
              :class="{ on: selected?.name === role.name }"
              @click="selected = role"
            >
              <BaseIcon :name="role.canLogin ? 'connect' : 'folder'" :size="13" class="pr-ic" />
              <span class="pr-name">{{ role.name }}</span>
              <span v-if="role.superuser" class="pr-flag super">superuser</span>
              <span v-else-if="role.system" class="pr-flag">system</span>
            </div>
          </div>

          <div class="pr-detail">
            <div v-if="!selected" class="pr-empty">Pick a role to see what it can do.</div>
            <template v-else>
              <div class="pr-head">
                <span class="pr-title">{{ selected.name }}</span>
                <FlexSpacer />
                <BaseButton
                  variant="ghost"
                  icon="trash"
                  :disabled="readOnly || !dropCheck.ok"
                  :title="readOnly ? 'This connection is read-only' : (dropCheck.reason || 'Drop this role')"
                  @click="confirming = selected"
                >Drop</BaseButton>
              </div>

              <div class="pr-section">Attributes</div>
              <div class="pr-chips">
                <span v-for="a in roleAttributes(selected, { withLimit: true })" :key="a" class="pr-chip">{{ a }}</span>
              </div>
              <div v-if="selected.validUntil" class="pr-note">Password valid until {{ selected.validUntil }}</div>

              <div class="pr-section">Member of</div>
              <div v-if="!selected.memberOf.length" class="pr-none">Belongs to no other role.</div>
              <div v-else class="pr-chips">
                <span v-for="g in selected.memberOf" :key="g" class="pr-chip link" @click="selected = all.find(r => r.name === g) ?? selected">{{ g }}</span>
              </div>

              <div class="pr-section">Members</div>
              <div v-if="!members.length" class="pr-none">No role belongs to this one.</div>
              <div v-else class="pr-chips">
                <span v-for="m in members" :key="m" class="pr-chip link" @click="selected = all.find(r => r.name === m) ?? selected">{{ m }}</span>
              </div>
            </template>
          </div>
        </div>

        <!-- Create: the common case only — a named role, optionally able to log in. -->
        <div v-if="adding" class="pr-form">
          <div class="pr-form-head">New role</div>
          <div class="pr-form-row">
            <BaseInput v-model="draft.name" placeholder="Role name" class="grow" v-focus />
            <BaseInput v-model="draft.password" type="password" placeholder="Password (optional)" class="grow" />
          </div>
          <div class="pr-form-row">
            <label><BaseCheckbox v-model="draft.canLogin" /> Can log in</label>
            <label><BaseCheckbox v-model="draft.createDb" /> Create databases</label>
            <label><BaseCheckbox v-model="draft.createRole" /> Create roles</label>
            <label class="danger"><BaseCheckbox v-model="draft.superuser" /> Superuser</label>
          </div>
          <div v-if="draft.superuser" class="pr-warn">
            <BaseIcon name="warn" :size="14" /> A superuser bypasses every permission check on this server.
          </div>
          <div v-if="formError" class="pr-error">{{ formError }}</div>
          <div class="pr-form-row end">
            <BaseButton variant="ghost" @click="adding = false; draft = { ...BLANK }">Cancel</BaseButton>
            <BaseButton variant="primary" :disabled="!draft.name.trim() || saving" @click="save">
              {{ saving ? 'Creating…' : 'Create role' }}
            </BaseButton>
          </div>
        </div>

        <!-- Dropping is refused by the server for a role that still owns objects; this
             only confirms the intent, and reports whatever the server says back. -->
        <div v-if="confirming" class="pr-confirm">
          <BaseIcon name="warn" :size="15" />
          <span>Drop role {{ confirming.name }}? This cannot be undone.</span>
          <FlexSpacer />
          <BaseButton variant="ghost" @click="confirming = null">Cancel</BaseButton>
          <BaseButton variant="danger" @click="confirmDrop">Drop role</BaseButton>
        </div>
      </template>
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.pr-bar { display: flex; align-items: center; gap: 6px; margin: 12px 0 10px; }
.pr-search { flex: 1; }
.pr-count { font-size: 12px; color: var(--text-faint); margin-right: 4px; }
.pr-split { display: flex; gap: 12px; height: 50vh; min-height: 0; }
.pr-list {
  flex: none; width: 300px; overflow-y: auto; padding: 6px;
  border: 1px solid var(--border); border-radius: 6px;
}
.pr-item { display: flex; align-items: center; gap: 6px; padding: 5px 7px; border-radius: 5px; cursor: pointer; font-size: 12.5px; }
.pr-item:hover { background: var(--bg-hover); }
.pr-item.on { background: var(--bg-active); }
.pr-ic { color: var(--text-faint); flex: none; }
.pr-name { flex: 1; font-family: var(--mono); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; }
.pr-flag { font-size: 10px; color: var(--text-faint); background: var(--bg-hover); border-radius: 3px; padding: 1px 5px; }
.pr-flag.super { color: var(--warn); }
.pr-detail { flex: 1; min-width: 0; overflow-y: auto; padding: 4px 2px; }
.pr-head { display: flex; align-items: center; gap: 8px; }
.pr-title { font-size: 14px; font-weight: 600; font-family: var(--mono); }
.pr-section { margin: 14px 0 6px; font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }
.pr-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pr-chip { padding: 2px 8px; border-radius: 10px; font-size: 11.5px; background: var(--bg-input); border: 1px solid var(--border-soft); }
.pr-chip.link { cursor: pointer; }
.pr-chip.link:hover { border-color: var(--accent); color: var(--text); }
.pr-none, .pr-empty { color: var(--text-faint); font-size: 12.5px; padding: 4px 0; }
.pr-empty { padding: 18px 8px; }
.pr-note { margin-top: 6px; font-size: 12px; color: var(--text-dim); }
.pr-form, .pr-confirm { margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-panel-2); }
.pr-form-head { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
.pr-form-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.pr-form-row.end { justify-content: flex-end; margin-bottom: 0; }
.pr-form-row label { display: flex; align-items: center; gap: 5px; font-size: 12.5px; }
.pr-form-row label.danger { color: var(--warn); }
.grow { flex: 1; }
.pr-warn { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 12px; color: var(--warn); }
.pr-error { margin-bottom: 8px; padding: 6px 8px; font-size: 12px; color: var(--danger-text); background: var(--danger-bg); border-radius: 5px; }
.pr-confirm { display: flex; align-items: center; gap: 8px; background: var(--danger-bg); border-color: var(--danger-text); font-size: 12.5px; }
</style>
