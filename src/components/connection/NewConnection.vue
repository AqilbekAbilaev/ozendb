<script setup>
import { ref, computed } from 'vue'
import { TAG_PRESETS } from '../../utils/tabColor.js'
import BaseIcon from '../base/BaseIcon.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import TabStrip from '../base/TabStrip.vue'
import Disclosure from '../base/Disclosure.vue'
import FormField from '../base/FormField.vue'
import { TABS } from '../../data/connectionOptions.js'
import { CONNECTION_EDITORS } from '../../engines/connectionEditor.js'
import ConnectionIntro from './ConnectionIntro.vue'
import { useConnectionForm } from '../../composables/useConnectionForm.js'
import { useMomentumScroll } from '../../composables/useMomentumScroll.js'

const props = defineProps({
  editConn: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved', 'updated'])

const isEditMode = !!props.editConn

// ── step: 'intro' | 'form'  (edit mode always starts on form)
const step = ref(isEditMode ? 'form' : 'intro')
const activeTab = ref('server')

const form = useConnectionForm(props.editConn)
const {
  connName, engine, database, hosts, username, password,
  useTls, tlsCaFile, tlsAllowInvalidCerts, pickTlsFile,
  useSsh, sshHost, sshPort, sshUser, sshAuth, sshPassword, sshKeyFile,
  sshKeyPassphrase, pickSshKey,
  selectedTag, readOnly, openGroups, toggleGroup,
  status, isTesting, isSaving, blockedByLiveConnection,
  testConnection,
} = form
const isPg = computed(() => engine.value === 'postgresql')
const editor = CONNECTION_EDITORS.mongodb

// Opens the form for the engine picked on the intro step, pre-filled when it parsed a
// connection string. `parsed` is null when the user chose to configure it by hand.
function startForm(parsed, pickedEngine) {
  form.setEngine(pickedEngine)
  step.value = 'form'
  activeTab.value = 'server'
  if (parsed) form.applyParsed(parsed)
}

async function save() {
  const result = await form.save()
  if (result) emit(result.event, result.conn)
}

async function saveAsNew() {
  const result = await form.saveAsNew()
  if (result) emit(result.event, result.conn)
}

// Touchpad swipes glide after the fingers lift, matching the app's panes.
const bodyEl = ref(null)
useMomentumScroll(bodyEl)
</script>

<template>
  <ConnectionIntro v-if="step === 'intro'" :engine="engine" :engine-locked="isEditMode" @close="$emit('close')" @next="startForm" />

  <!-- ── Form step ──────────────────────────────────── -->
  <BaseModal v-else :title="isEditMode ? 'Edit Connection' : 'New Connection'" width="720px" max-width="94vw" height="600px" max-height="92vh" @close="$emit('close')">

      <!-- Name row -->
      <div class="nc-top">
        <label class="nc-namelbl">Connection name</label>
        <BaseInput class="nc-name" v-model="connName" />
        <BaseButton v-if="!isPg" bordered @click="step = 'intro'">
          <BaseIcon name="uri" :size="15" /> From URI
        </BaseButton>
      </div>

      <!-- Tabs -->
      <div class="nc-tabs">
        <TabStrip
          :model-value="activeTab"
          :options="TABS.map(([value, label]) => ({ value, label }))"
          @update:model-value="activeTab = $event"
        />
      </div>

      <!-- Tab body -->
      <div ref="bodyEl" class="nc-body">

        <!-- Server / Authentication / SSL -->
        <div v-if="activeTab === 'server' && isPg" class="nc-form">
          <FormField label="Server">
            <div v-for="(h, i) in hosts" :key="i" class="nc-inline nc-host-row">
              <BaseInput class="nc-input" v-model="h.host" style="flex:3" placeholder="localhost" />
              <span class="nc-colon">:</span>
              <BaseInput class="nc-input" v-model="h.port" type="number" style="flex:1" />
            </div>
          </FormField>
          <FormField label="Database">
            <BaseInput class="nc-input" v-model="database" placeholder="postgres" />
          </FormField>
        </div>
        <div v-else-if="activeTab === 'auth' && isPg" class="nc-form">
          <FormField label="User name">
            <BaseInput class="nc-input" v-model="username" />
          </FormField>
          <FormField label="Password">
            <BaseInput
              class="nc-input"
              type="password"
              v-model="password"
              :placeholder="isEditMode ? 'Leave blank to keep existing password' : ''"
            />
          </FormField>
        </div>
        <div v-else-if="activeTab === 'ssl' && isPg" class="nc-form">
          <label class="chk-line big" @click="useTls = !useTls">
            <span class="cb" :class="{ on: useTls }"><BaseIcon v-if="useTls" name="check" :size="12" /></span>
            Use SSL/TLS protocol to connect
          </label>

          <template v-if="useTls">
            <FormField label="Certificate Authority (.pem)">
              <div class="nc-file-row">
                <BaseInput class="nc-input" v-model="tlsCaFile" placeholder="Path to CA certificate" />
                <BaseButton bordered type="button" @click="pickTlsFile('ca')">Browse…</BaseButton>
              </div>
            </FormField>

            <label class="chk-line" @click="tlsAllowInvalidCerts = !tlsAllowInvalidCerts">
              <span class="cb" :class="{ on: tlsAllowInvalidCerts }"><BaseIcon v-if="tlsAllowInvalidCerts" name="check" :size="12" /></span>
              Allow invalid certificates (accept self-signed / expired)
            </label>
            <div class="nc-hint">A Certificate Authority file verifies the server securely; “allow invalid certificates” skips that check.</div>
          </template>
        </div>

        <!-- SSH Tunnel -->
        <div v-else-if="activeTab === 'ssh'" class="nc-form">
          <label class="chk-line big" @click="useSsh = !useSsh">
            <span class="cb" :class="{ on: useSsh }"><BaseIcon v-if="useSsh" name="check" :size="12" /></span>
            Use SSH tunnel
          </label>

          <template v-if="useSsh">
            <div class="nc-inline2">
              <FormField label="SSH host" style="flex:1">
                <BaseInput class="nc-input" v-model="sshHost" placeholder="bastion.example.com" />
              </FormField>
              <FormField label="Port" style="width:92px">
                <BaseInput class="nc-input" type="number" v-model="sshPort" />
              </FormField>
            </div>
            <FormField label="SSH user">
              <BaseInput class="nc-input" v-model="sshUser" />
            </FormField>
            <FormField label="Authentication">
              <SegmentedControl
                class="nc-seg"
                :model-value="sshAuth"
                :options="[{ value: 'password', label: 'Password' }, { value: 'key', label: 'Private key' }]"
                @update:model-value="sshAuth = $event"
              />
            </FormField>

            <FormField v-if="sshAuth === 'password'" label="SSH password">
              <BaseInput class="nc-input" type="password" v-model="sshPassword" :placeholder="isEditMode ? 'Leave blank to keep existing' : ''" />
            </FormField>
            <template v-else>
              <FormField label="Private key file">
                <div class="nc-file-row">
                  <BaseInput class="nc-input" v-model="sshKeyFile" placeholder="~/.ssh/id_ed25519" />
                  <BaseButton bordered type="button" @click="pickSshKey">Browse…</BaseButton>
                </div>
              </FormField>
              <FormField label="Key passphrase (optional)">
                <BaseInput class="nc-input" type="password" v-model="sshKeyPassphrase" :placeholder="isEditMode ? 'Leave blank to keep existing' : ''" />
              </FormField>
            </template>

            <div class="nc-hint">The server host/port (Server tab) are resolved from the SSH host.<template v-if="!isPg"> Standalone connections only — replica set / SRV over SSH aren't supported yet.</template></div>
          </template>
        </div>

        <div v-else-if="activeTab !== 'advanced'" class="nc-form">
          <component :is="editor.sections[activeTab]" :form="form" />
        </div>

        <!-- Advanced -->
        <div v-else class="nc-form">
          <component :is="editor.sections.advanced" v-if="!isPg" :form="form" />

          <Disclosure
            class="nc-adv-group"
            :model-value="openGroups.Appearance"
            @update:model-value="toggleGroup('Appearance')"
          >
            <span class="nc-adv-group-t">Appearance</span>
            <span v-if="selectedTag !== 'none'" class="nc-adv-badge">1 set</span>
          </Disclosure>
          <FormField v-if="openGroups.Appearance" label="Color tag">
            <div class="tag-row">
              <span
                v-for="p in TAG_PRESETS"
                :key="p.name"
                class="tag-swatch"
                :class="{ on: selectedTag === p.name }"
                :style="p.name === 'none'
                  ? { background: 'transparent', border: '1px solid var(--border-soft)' }
                  : { background: p.color }"
                @click="selectedTag = p.name"
              ></span>
            </div>
          </FormField>

          <label class="chk-line nc-readonly" @click="readOnly = !readOnly">
            <span class="cb" :class="{ on: readOnly }"><BaseIcon v-if="readOnly" name="check" :size="12" /></span>
            Read-only connection
          </label>
          <div class="nc-hint">Blocks every write (insert, update, delete, drop, index changes…) against this connection at the backend.</div>
        </div>

      </div>

      <!-- Status -->
      <div v-if="status" class="nc-status" :class="status.type">{{ status.message }}</div>

      <!-- Footer -->
      <div class="cm-footer">
        <BaseButton bordered :disabled="isTesting" @click="testConnection">
          <BaseIcon name="connect" :size="15" />
          {{ isTesting ? 'Testing…' : 'Test Connection' }}
        </BaseButton>
        <span class="spacer"></span>
        <BaseButton bordered @click="$emit('close')">Cancel</BaseButton>
        <BaseButton
          v-if="blockedByLiveConnection"
          bordered
          :disabled="isSaving"
          @click="saveAsNew"
        >Save as new connection</BaseButton>
        <BaseButton variant="primary" :disabled="isSaving" @click="save">
          {{ isSaving ? 'Saving…' : (isEditMode ? 'Save Changes' : 'Save') }}
        </BaseButton>
      </div>

  </BaseModal>
</template>

<style src="./NewConnection.css" scoped></style>
