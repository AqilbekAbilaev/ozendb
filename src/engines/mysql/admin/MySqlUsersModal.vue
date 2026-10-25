<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { users as listUsers, createUser, dropUser, grants as listGrants } from '../api/admin'
import { errText, errCode } from '../../../utils/errors'
import { accountName, userAttributes, matchUsers, canDropUser } from './userRows'
import { openConnections } from '../../../stores/openConnections'
import { showToast } from '../../../stores/toast'
import { openModal } from '../../../stores/modals'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// Opened from a MySQL connection's right-click menu. Accounts are server-wide, each a
// user at a host; picking one shows its privileges as SHOW GRANTS states them.
const props = defineProps({
  target: { type: Object, required: true },   // { connId, connName, … }
})
defineEmits(['close'])

const BLANK = { user: '', host: '%', password: '' }

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const all = ref([])
const filters = ref({ search: '', showSystem: false })
const selected = ref(null)
const grants = ref([])
const grantsError = ref(null)
const adding = ref(false)
const draft = ref({ ...BLANK })
const saving = ref(false)
const formError = ref(null)
const confirming = ref(null)

const readOnly = computed(() =>
  !!openConnections.value.find(c => c.id === props.target.connId)?.read_only)

async function load() {
  try {
    all.value = await listUsers(props.target.connId)
    error.value = null
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

watch(selected, async (account) => {
  grants.value = []
  grantsError.value = null
  if (!account) return
  try {
    const read = await listGrants(props.target.connId, account)
    if (selected.value === account) grants.value = read
  } catch (e) {
    if (selected.value === account) grantsError.value = errText(e)
  }
})

const shown = computed(() => matchUsers(all.value, filters.value))
const dropCheck = computed(() => (selected.value ? canDropUser(selected.value) : { ok: false }))

async function save() {
  if (saving.value) return
  saving.value = true
  formError.value = null
  const account = { user: draft.value.user.trim(), host: draft.value.host.trim() }
  try {
    // An empty box means no password at all, rather than an empty one.
    await createUser(props.target.connId, { ...account, password: draft.value.password || null })
    showToast(`Account ${accountName(account)} created`)
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
  const account = confirming.value
  try {
    await dropUser(props.target.connId, account)
    showToast(`Account ${accountName(account)} dropped`)
    if (selected.value === account) selected.value = null
    await load()
  } catch (e) {
    showToast(errText(e))
  } finally {
    confirming.value = null
  }
}
</script>

<template>
  <BaseModal :title="`Users — ${target.connName}`" width="940px" max-width="95vw" @close="$emit('close')">
    <BaseModalBody>
      <StateMessage v-if="loading" mode="loading" label="Reading accounts…" />
      <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" retryable @retry="load" />
      <template v-else>
        <div class="mu-bar">
          <BaseInput v-model="filters.search" placeholder="Search an account by user or host…" class="mu-search" />
          <BaseButton bordered :active="filters.showSystem" title="MySQL's own reserved accounts" @click="filters.showSystem = !filters.showSystem">
            System
          </BaseButton>
          <FlexSpacer />
          <span class="mu-count">{{ shown.length }} of {{ all.length }}</span>
          <BaseButton
            variant="primary"
            icon="plus"
            :disabled="readOnly"
            :title="readOnly ? 'This connection is read-only' : 'Create an account'"
            @click="adding = true; formError = null"
          >New user</BaseButton>
        </div>

        <div class="mu-split">
          <div class="mu-list">
            <div v-if="!shown.length" class="mu-empty">No account matches.</div>
            <div
              v-for="u in shown"
              :key="accountName(u)"
              class="mu-item"
              :class="{ on: selected === u }"
              @click="selected = u"
            >
              <BaseIcon :name="u.locked ? 'lock' : 'connect'" :size="13" class="mu-ic" />
              <span class="mu-name">{{ accountName(u) }}</span>
              <span v-if="u.current" class="mu-flag">you</span>
              <span v-else-if="u.system" class="mu-flag">system</span>
            </div>
          </div>

          <div class="mu-detail">
            <div v-if="!selected" class="mu-empty">Pick an account to see what it may do.</div>
            <template v-else>
              <div class="mu-head">
                <span class="mu-title">{{ accountName(selected) }}</span>
                <FlexSpacer />
                <BaseButton
                  variant="ghost"
                  icon="key"
                  title="Grant or revoke this account's privileges"
                  @click="openModal('mysqlGrants', { connId: target.connId, connName: target.connName, user: selected.user, host: selected.host })"
                >Grants…</BaseButton>
                <BaseButton
                  variant="ghost"
                  icon="trash"
                  :disabled="readOnly || !dropCheck.ok"
                  :title="readOnly ? 'This connection is read-only' : (dropCheck.reason || 'Drop this account')"
                  @click="confirming = selected"
                >Drop</BaseButton>
              </div>

              <div class="mu-section">Attributes</div>
              <div class="mu-chips">
                <span v-for="a in userAttributes(selected)" :key="a" class="mu-chip">{{ a }}</span>
              </div>

              <div class="mu-section">Privileges</div>
              <div v-if="grantsError" class="mu-error">{{ grantsError }}</div>
              <pre v-for="g in grants" v-else :key="g" class="mu-grant">{{ g }}</pre>
            </template>
          </div>
        </div>

        <!-- Create: the common case only — a user, its host, and an optional password. -->
        <div v-if="adding" class="mu-form">
          <div class="mu-form-head">New user</div>
          <div class="mu-form-row">
            <BaseInput v-model="draft.user" placeholder="User name" class="grow" v-focus />
            <BaseInput v-model="draft.host" placeholder="Host (% for any)" class="grow" />
            <BaseInput v-model="draft.password" type="password" placeholder="Password (optional)" class="grow" />
          </div>
          <div v-if="formError" class="mu-error">{{ formError }}</div>
          <div class="mu-form-row end">
            <BaseButton variant="ghost" @click="adding = false; draft = { ...BLANK }">Cancel</BaseButton>
            <BaseButton variant="primary" :disabled="!draft.user.trim() || !draft.host.trim() || saving" @click="save">
              {{ saving ? 'Creating…' : 'Create user' }}
            </BaseButton>
          </div>
        </div>

        <div v-if="confirming" class="mu-confirm">
          <span>Drop account {{ accountName(confirming) }}? This cannot be undone.</span>
          <FlexSpacer />
          <BaseButton variant="ghost" @click="confirming = null">Cancel</BaseButton>
          <BaseButton variant="danger" @click="confirmDrop">Drop account</BaseButton>
        </div>
      </template>
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.mu-bar { display: flex; align-items: center; gap: 6px; margin: 12px 0 10px; }
.mu-search { flex: 1; }
.mu-count { font-size: 12px; color: var(--text-faint); margin-right: 4px; }
.mu-split { display: flex; gap: 12px; height: 50vh; min-height: 0; }
.mu-list {
  flex: none; width: 300px; overflow-y: auto; padding: 6px;
  border: 1px solid var(--border); border-radius: 6px;
}
.mu-item { display: flex; align-items: center; gap: 6px; padding: 5px 7px; border-radius: 5px; cursor: pointer; font-size: 12.5px; }
.mu-item:hover { background: var(--bg-hover); }
.mu-item.on { background: var(--bg-active); }
.mu-ic { color: var(--text-faint); flex: none; }
.mu-name { flex: 1; font-family: var(--mono); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; }
.mu-flag { font-size: 10px; color: var(--text-faint); background: var(--bg-hover); border-radius: 3px; padding: 1px 5px; }
.mu-detail { flex: 1; min-width: 0; overflow-y: auto; padding: 4px 2px; }
.mu-head { display: flex; align-items: center; gap: 8px; }
.mu-title { font-size: 14px; font-weight: 600; font-family: var(--mono); }
.mu-section { margin: 14px 0 6px; font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }
.mu-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mu-chip { padding: 2px 8px; border-radius: 10px; font-size: 11.5px; background: var(--bg-input); border: 1px solid var(--border-soft); }
.mu-grant {
  margin: 0 0 6px; padding: 6px 8px; font-family: var(--mono); font-size: 11.5px; white-space: pre-wrap; word-break: break-word;
  color: var(--text); background: var(--bg-input); border-radius: 5px; user-select: text;
}
.mu-empty { color: var(--text-faint); font-size: 12.5px; padding: 18px 8px; }
.mu-form, .mu-confirm { margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-panel-2); }
.mu-form-head { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
.mu-form-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.mu-form-row.end { justify-content: flex-end; margin-bottom: 0; }
.grow { flex: 1; }
.mu-error { margin-bottom: 8px; padding: 6px 8px; font-size: 12px; color: var(--danger-text); background: var(--danger-bg); border-radius: 5px; }
.mu-confirm { display: flex; align-items: center; gap: 8px; background: var(--danger-bg); border-color: var(--danger-text); font-size: 12.5px; }
</style>
