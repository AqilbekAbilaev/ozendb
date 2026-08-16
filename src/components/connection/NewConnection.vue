<script setup>
import { ref } from 'vue'
import { TAG_PRESETS } from '../../utils/tabColor.js'
import BaseIcon from '../base/BaseIcon.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import TabStrip from '../base/TabStrip.vue'
import Disclosure from '../base/Disclosure.vue'
import FormField from '../base/FormField.vue'
import HintText from '../base/HintText.vue'
import {
  OPTION_GROUPS, TABS, AUTH_MODE_OPTIONS, READ_PREF_OPTIONS, BOOL_OPTIONS,
  OIDC_ENVIRONMENTS, enumOptions,
} from '../../data/connectionOptions.js'
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
  connName, hosts, connType, replicaSetName, readPreference, isMultiHost,
  addHost, removeHost,
  authMode, username, password, authDb,
  oidcEnvironment, oidcTokenResource, oidcNeedsResource,
  useTls, tlsCaFile, tlsCertKeyFile, tlsAllowInvalidCerts, pickTlsFile,
  useSsh, sshHost, sshPort, sshUser, sshAuth, sshPassword, sshKeyFile,
  sshKeyPassphrase, pickSshKey,
  selectedTag, readOnly,
  advancedOptions, optionVisible, optionDisabled, groupSetCount, openGroups, toggleGroup,
  status, isTesting, isSaving, blockedByLiveConnection,
  testConnection,
} = form

// Opens the form, pre-filled when the intro step parsed a connection string. `parsed`
// is null when the user chose to configure the connection by hand.
function startForm(parsed) {
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
  <ConnectionIntro v-if="step === 'intro'" @close="$emit('close')" @next="startForm" />

  <!-- ── Form step ──────────────────────────────────── -->
  <BaseModal v-else :title="isEditMode ? 'Edit Connection' : 'New Connection'" width="720px" max-width="94vw" height="600px" max-height="92vh" @close="$emit('close')">

      <!-- Name row -->
      <div class="nc-top">
        <label class="nc-namelbl">Connection name</label>
        <BaseInput class="nc-name" v-model="connName" />
        <BaseButton bordered @click="step = 'intro'">
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

        <!-- Server -->
        <div v-if="activeTab === 'server'" class="nc-form">
          <FormField label="Connection type">
            <SegmentedControl
              class="nc-seg"
              :model-value="connType"
              :options="[{ value: 'standalone', label: 'Standalone' }, { value: 'replica', label: 'Replica Set' }, { value: 'sharded', label: 'Sharded' }, { value: 'srv', label: 'DNS Seedlist (SRV)' }]"
              @update:model-value="connType = $event"
            />
          </FormField>
          <FormField :label="connType === 'srv' ? 'Server (SRV hostname)' : (isMultiHost ? 'Server(s)' : 'Server')">
            <BaseInput v-if="connType === 'srv'" class="nc-input" v-model="hosts[0].host" placeholder="cluster.example.com" />
            <template v-else>
              <div v-for="(h, i) in hosts" :key="i" class="nc-inline nc-host-row">
                <BaseInput class="nc-input" v-model="h.host" style="flex:3" placeholder="localhost" />
                <span class="nc-colon">:</span>
                <BaseInput class="nc-input" v-model="h.port" type="number" style="flex:1" />
                <BaseButton v-if="isMultiHost && hosts.length > 1" icon="close" :icon-size="12" title="Remove host" @click="removeHost(i)" />
              </div>
              <BaseButton v-if="isMultiHost" variant="ghost" size="sm" class="nc-host-add" @click="addHost">
                <BaseIcon name="plus" :size="12" /> Add host
              </BaseButton>
            </template>
          </FormField>
          <FormField v-if="connType === 'replica'" label="Replica set name">
            <BaseInput class="nc-input" v-model="replicaSetName" placeholder="myReplicaSet" />
          </FormField>
          <FormField v-if="connType !== 'standalone'" label="Read preference">
            <BaseSelect class="nc-sel" v-model="readPreference" :options="READ_PREF_OPTIONS" />
          </FormField>
          <div class="nc-hint">
            OzenDB currently targets MongoDB.
            PostgreSQL &amp; MySQL engines arrive in a future release.
          </div>
        </div>

        <!-- Authentication -->
        <div v-else-if="activeTab === 'auth'" class="nc-form">
          <FormField label="Authentication mode">
            <BaseSelect class="nc-sel" v-model="authMode" :options="AUTH_MODE_OPTIONS">
              <template #option="{ option }">
                <span>{{ option.label }}</span>
                <span v-if="option.soon" class="nc-soon">soon</span>
              </template>
            </BaseSelect>
          </FormField>

          <template v-if="authMode !== 'none' && authMode !== 'OIDC'">
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
            <FormField label="Authentication DB">
              <BaseInput class="nc-input" v-model="authDb" :placeholder="authMode === 'PLAIN' ? '$external' : 'admin'" />
            </FormField>
            <div v-if="authMode === 'PLAIN'" class="nc-hint">
              LDAP (PLAIN) requires SSL/TLS. Enable SSL in the SSL tab.
            </div>
          </template>

          <template v-else-if="authMode === 'OIDC'">
            <FormField label="Environment">
              <BaseSelect class="nc-sel" v-model="oidcEnvironment" :options="OIDC_ENVIRONMENTS" />
            </FormField>
            <FormField v-if="oidcNeedsResource" label="Token resource">
              <BaseInput class="nc-input" v-model="oidcTokenResource" placeholder="e.g. api://&lt;app-id&gt;" />
            </FormField>
            <div class="nc-hint">
              Workload-identity OIDC: the token is obtained from the {{ oidcEnvironment }} environment — no username or password.
              Interactive (device-flow) OIDC isn't supported yet.
            </div>
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

            <div class="nc-hint">The MongoDB host/port (Server tab) are resolved from the SSH host. Standalone connections only — replica set / SRV over SSH aren't supported yet.</div>
          </template>
        </div>

        <!-- SSL -->
        <div v-else-if="activeTab === 'ssl'" class="nc-form">
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

            <FormField label="Client Certificate + Key (.pem)">
              <div class="nc-file-row">
                <BaseInput class="nc-input" v-model="tlsCertKeyFile" placeholder="Path to client certificate (optional)" />
                <BaseButton bordered type="button" @click="pickTlsFile('cert')">Browse…</BaseButton>
              </div>
            </FormField>

            <label class="chk-line" @click="tlsAllowInvalidCerts = !tlsAllowInvalidCerts">
              <span class="cb" :class="{ on: tlsAllowInvalidCerts }"><BaseIcon v-if="tlsAllowInvalidCerts" name="check" :size="12" /></span>
              Allow invalid certificates (accept self-signed / expired)
            </label>
            <div class="nc-hint">A Certificate Authority file verifies the server securely; “allow invalid certificates” skips that check.</div>
          </template>
        </div>

        <!-- Advanced -->
        <div v-else-if="activeTab === 'advanced'" class="nc-form">
          <div class="nc-hint nc-adv-intro">
            Optional MongoDB driver parameters. Leave a field empty to use the driver default.
          </div>

          <template v-for="group in OPTION_GROUPS" :key="group.title">
            <Disclosure
              class="nc-adv-group"
              :model-value="openGroups[group.title]"
              @update:model-value="toggleGroup(group.title)"
            >
              <span class="nc-adv-group-t">{{ group.title }}</span>
              <span v-if="groupSetCount(group)" class="nc-adv-badge">{{ groupSetCount(group) }} set</span>
            </Disclosure>
            <template v-if="openGroups[group.title]">
              <template v-for="opt in group.options" :key="opt.key">
              <FormField v-if="optionVisible(opt)">
                <template #label>
                  {{ opt.label }}
                  <span class="nc-adv-key">{{ opt.key }}</span>
                </template>

                <BaseSelect
                  v-if="opt.type === 'bool'"
                  class="nc-sel"
                  v-model="advancedOptions[opt.key]"
                  :options="BOOL_OPTIONS"
                  :disabled="optionDisabled(opt)"
                />

                <BaseSelect
                  v-else-if="opt.type === 'enum'"
                  class="nc-sel"
                  v-model="advancedOptions[opt.key]"
                  :options="enumOptions(opt)"
                  :disabled="optionDisabled(opt)"
                />

                <BaseInput
                  v-else
                  class="nc-input"
                  :type="opt.type === 'int' ? 'number' : 'text'"
                  v-model="advancedOptions[opt.key]"
                  :placeholder="opt.placeholder || ''"
                  :disabled="optionDisabled(opt)"
                />

                <HintText v-if="opt.hint">{{ opt.hint }}</HintText>
              </FormField>
              </template>
            </template>
          </template>

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
