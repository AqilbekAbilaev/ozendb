<script setup>
import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { emit as tauriEmit } from '@tauri-apps/api/event'
import { errText } from '../../utils/errors'
import { TAG_PRESETS } from '../../utils/tabColor.js'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import BaseIcon from '../base/BaseIcon.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import TabStrip from '../base/TabStrip.vue'
import Disclosure from '../base/Disclosure.vue'
import FieldError from '../base/FieldError.vue'
import FormField from '../base/FormField.vue'
import HintText from '../base/HintText.vue'
import { OPTION_GROUPS, KNOWN_OPTION_KEYS } from '../../data/connectionOptions.js'
import { partitionUriOptions } from '../../utils/connectionUri.js'

const props = defineProps({
  editConn: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved', 'updated'])

const isEditMode = !!props.editConn

// ── step: 'intro' | 'form'  (edit mode always starts on form)
const step     = ref(isEditMode ? 'form' : 'intro')
const mode     = ref('uri')
const pastedUri = ref('')
const uriError  = ref('')

// ── form state — pre-filled from editConn in edit mode
const connName  = ref(isEditMode ? props.editConn.name : 'New Connection')
const activeTab = ref('server')

// server tab
// Seed list — always at least one { host, port } row. In edit mode it comes
// from the stored config (already a `hosts` array after backend migration).
const hosts = ref(
  isEditMode && Array.isArray(props.editConn.hosts) && props.editConn.hosts.length
    ? props.editConn.hosts.map(h => ({ host: h.host, port: h.port }))
    : [{ host: 'localhost', port: 27017 }]
)
const connType       = ref(isEditMode ? props.editConn.connection_type : 'standalone')
const replicaSetName = ref(isEditMode ? (props.editConn.replica_set_name ?? '') : '')

// Read preference lives on the Server tab (not Advanced) because it only makes
// sense for replica sets / sharded / SRV. '' means unset → driver default
// (primary). Stored in the connection's `options` map like other URI params.
const readPreference = ref(
  (isEditMode && props.editConn.options) ? (props.editConn.options.readPreference ?? '') : ''
)

// Only replica sets and sharded clusters use a multi-host seed list; standalone
// and SRV are single-host.
const isMultiHost = computed(() => connType.value === 'replica' || connType.value === 'sharded')

function addHost() { hosts.value.push({ host: '', port: 27017 }) }
function removeHost(index) { if (hosts.value.length > 1) hosts.value.splice(index, 1) }

// Switching to a single-host type drops any extra seed-list entries so the
// built URI doesn't carry hosts the type can't use. Standalone has no read
// preference, so clear it too (keeps it out of the URI and disables the
// Advanced fields that depend on it).
watch(connType, (type) => {
  if (!isMultiHost.value && hosts.value.length > 1) {
    hosts.value = [hosts.value[0]]
  }
  if (type === 'standalone') {
    readPreference.value = ''
  }
})

// auth tab
const authMode  = ref(isEditMode ? (props.editConn.auth_mechanism ?? 'SCRAM-SHA-256') : 'SCRAM-SHA-256')
const username  = ref(isEditMode ? (props.editConn.username ?? '') : '')
const password  = ref('')   // never pre-filled — empty means "keep existing"
const authDb    = ref(isEditMode ? (props.editConn.auth_db ?? 'admin') : 'admin')

const AUTH_MODES = [
  { value: 'none',          label: 'None',                            available: true  },
  { value: 'SCRAM-SHA-256', label: 'Basic (SCRAM-SHA-256)',           available: true  },
  { value: 'SCRAM-SHA-1',   label: 'Legacy (SCRAM-SHA-1)',            available: true  },
  { value: 'PLAIN',         label: 'LDAP (PLAIN)',                    available: true  },
  { value: 'X509',          label: 'X.509',                           available: false },
  { value: 'GSSAPI',        label: 'Kerberos (GSSAPI)',               available: false },
  { value: 'AWS',           label: 'AWS Identity and Access Management (IAM)', available: false },
  { value: 'OIDC',          label: 'OIDC — workload identity',        available: true  },
]
// Auth-mode options for BaseSelect: unavailable modes are disabled and badged "soon".
const authModeOptions = AUTH_MODES.map((m) => ({
  value: m.value, label: m.label, disabled: !m.available, soon: !m.available,
}))
const READ_PREF_OPTIONS = [
  { value: '',                   label: 'Primary (default)' },
  { value: 'primaryPreferred',   label: 'Primary preferred' },
  { value: 'secondary',          label: 'Secondary' },
  { value: 'secondaryPreferred', label: 'Secondary preferred' },
  { value: 'nearest',            label: 'Nearest' },
]
const BOOL_OPTIONS = [
  { value: '',      label: '(default)' },
  { value: 'true',  label: 'true' },
  { value: 'false', label: 'false' },
]
// Advanced enum option: '(default)' plus the catalog's allowed values.
function enumOptions(opt) {
  return [{ value: '', label: '(default)' }, ...opt.values.map((v) => ({ value: v, label: v }))]
}

// OIDC (MONGODB-OIDC) workload/machine identity: the driver acquires the token from the
// cloud environment, so there's no username/password. `test` is the driver's built-in
// test flow (reads a token file); azure/gcp need a TOKEN_RESOURCE (the audience).
const OIDC_ENVIRONMENTS = [
  { value: 'azure', label: 'Azure' },
  { value: 'gcp',   label: 'GCP' },
  { value: 'test',  label: 'Test' },
]
const oidcEnvironment = ref('azure')
const oidcTokenResource = ref('')
const oidcNeedsResource = computed(() => oidcEnvironment.value === 'azure' || oidcEnvironment.value === 'gcp')

// In edit mode, recover the OIDC settings from the stored authMechanismProperties string
// (e.g. "ENVIRONMENT:azure,TOKEN_RESOURCE:api://abc"). Split each pair on its FIRST colon
// so a resource value containing ':' (like a URL) survives.
if (isEditMode && props.editConn.auth_mechanism === 'OIDC' && props.editConn.options) {
  const amp = props.editConn.options.authMechanismProperties || ''
  for (const part of amp.split(',')) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key === 'ENVIRONMENT') oidcEnvironment.value = value || 'azure'
    if (key === 'TOKEN_RESOURCE') oidcTokenResource.value = value
  }
}

// The authMechanismProperties string the driver needs for the selected OIDC environment.
function oidcMechanismProperties() {
  let properties = `ENVIRONMENT:${oidcEnvironment.value}`
  if (oidcNeedsResource.value && oidcTokenResource.value.trim()) {
    properties += `,TOKEN_RESOURCE:${oidcTokenResource.value.trim()}`
  }
  return properties
}


// ssl tab
const useTls              = ref(isEditMode ? !!props.editConn.tls : false)
const tlsCaFile           = ref(isEditMode ? (props.editConn.tls_ca_file ?? '') : '')
const tlsCertKeyFile      = ref(isEditMode ? (props.editConn.tls_cert_key_file ?? '') : '')
const tlsAllowInvalidCerts = ref(isEditMode ? !!props.editConn.tls_allow_invalid_certificates : false)

async function pickTlsFile(target) {
  try {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: 'Certificate', extensions: ['pem', 'crt', 'cert', 'cer', 'key'] }],
    })
    if (typeof picked === 'string') {
      if (target === 'ca') tlsCaFile.value = picked
      else tlsCertKeyFile.value = picked
    }
  } catch (_) {}
}

// ssh tab
const useSsh          = ref(isEditMode ? !!props.editConn.ssh_enabled : false)
const sshHost         = ref(isEditMode ? (props.editConn.ssh_host ?? '') : '')
const sshPort         = ref(isEditMode ? (props.editConn.ssh_port ?? 22) : 22)
const sshUser         = ref(isEditMode ? (props.editConn.ssh_user ?? '') : '')
const sshAuth         = ref(isEditMode ? (props.editConn.ssh_auth ?? 'password') : 'password')
const sshPassword     = ref('')   // never pre-filled — empty means "keep existing"
const sshKeyFile      = ref(isEditMode ? (props.editConn.ssh_key_file ?? '') : '')
const sshKeyPassphrase = ref('')  // never pre-filled

async function pickSshKey() {
  try {
    const picked = await openDialog({ multiple: false })
    if (typeof picked === 'string') sshKeyFile.value = picked
  } catch (_) {}
}

// advanced tab
const selectedTag = ref(isEditMode ? (props.editConn.tag ?? 'none') : 'none')

// Read-only connection: when set, the backend refuses every mutating operation
// against this connection (a real lock, see client_for_write in Rust).
const readOnly = ref(isEditMode ? !!props.editConn.read_only : false)

// Connection-string options (the Advanced tab). Each catalog key maps to a
// string value; '' means "unset", so the driver default applies. Values come
// from the stored config in edit mode.
const storedOptions = (isEditMode && props.editConn.options) ? props.editConn.options : {}
const advancedOptions = ref(
  Object.fromEntries(
    KNOWN_OPTION_KEYS.map(key => [
      key,
      storedOptions[key] != null ? String(storedOptions[key]) : '',
    ])
  )
)
// Options managed by dedicated fields outside the catalog (so they aren't
// treated as "unknown" passthrough below).
const DEDICATED_OPTION_KEYS = ['readPreference']

// Any stored option without a dedicated field (e.g. a key added by a future
// driver, or hand-edited JSON) is preserved verbatim so saving never drops it.
const extraOptions = Object.fromEntries(
  Object.entries(storedOptions).filter(
    ([key]) => !KNOWN_OPTION_KEYS.includes(key) && !DEDICATED_OPTION_KEYS.includes(key)
  )
)

// Unknown options captured when importing a connection string (no dedicated field and
// not in the catalog). Kept reactive so buildOptions carries them through on save, so an
// imported URI never loses a parameter — matching Studio 3T's import.
const importedExtraOptions = ref({})

// maxStalenessSeconds / readPreferenceTags are only valid alongside a
// non-primary read preference; the driver rejects the whole URI otherwise.
// Standalone has no read preference at all.
const readPrefActive = computed(() => connType.value !== 'standalone' && !!readPreference.value)

// Whether a field is shown at all (SRV-only options are hidden for non-SRV).
function optionVisible(opt) {
  if (opt.srvOnly && connType.value !== 'srv') return false
  return true
}

// Whether a visible field is greyed out because its dependency isn't met.
function optionDisabled(opt) {
  if (opt.needsReadPref && !readPrefActive.value) return true
  return false
}

// Assembles the options map sent to the backend: every set, visible, enabled
// field plus any preserved unknown options. Disabled/hidden/empty are omitted
// so the built URI only ever carries valid, driver-accepted parameters.
function buildOptions() {
  const out = { ...extraOptions, ...importedExtraOptions.value }
  for (const group of OPTION_GROUPS) {
    for (const opt of group.options) {
      if (!optionVisible(opt) || optionDisabled(opt)) continue
      const value = advancedOptions.value[opt.key]
      if (value === '' || value == null) continue
      out[opt.key] = String(value)
    }
  }
  // Read preference (Server tab) rides in the same options map.
  if (readPrefActive.value) {
    out.readPreference = readPreference.value
  }
  // OIDC carries its environment/token-resource as authMechanismProperties.
  if (authMode.value === 'OIDC') {
    out.authMechanismProperties = oidcMechanismProperties()
  } else {
    delete out.authMechanismProperties
  }
  return out
}

// The Advanced tab has many options, so each category is a collapsible section.
// `groupSetCount` powers the "n set" badge and the auto-expand default below.
function groupSetCount(group) {
  let count = 0
  for (const opt of group.options) {
    if (!optionVisible(opt) || optionDisabled(opt)) continue
    const value = advancedOptions.value[opt.key]
    if (value !== '' && value != null) count++
  }
  return count
}

// A group starts expanded only if it already holds a set value, so existing
// configuration is visible without the user expanding everything by hand.
const openGroups = ref({
  ...Object.fromEntries(OPTION_GROUPS.map(group => [group.title, groupSetCount(group) > 0])),
  Appearance: selectedTag.value !== 'none',
})

function toggleGroup(title) {
  openGroups.value[title] = !openGroups.value[title]
}

// status
const status    = ref(null)
const isTesting = ref(false)
const isSaving  = ref(false)


const TABS = [
  ['server', 'Server'],
  ['auth', 'Authentication'],
  ['ssh', 'SSH Tunnel'],
  ['ssl', 'SSL'],
  ['advanced', 'Advanced'],
]

// Builds a temporary URI from form fields — used only for Test Connection.
function buildUriForTest() {
  const isSrv = connType.value === 'srv'
  const scheme = isSrv ? 'mongodb+srv' : 'mongodb'
  let uri = `${scheme}://`
  if (username.value && password.value) {
    uri += `${encodeURIComponent(username.value)}:${encodeURIComponent(password.value)}@`
  } else if (username.value) {
    uri += `${encodeURIComponent(username.value)}@`
  }
  uri += isSrv
    ? hosts.value[0].host
    : hosts.value.map(h => `${h.host}:${h.port}`).join(',')
  uri += `/${authDb.value || 'admin'}`
  const params = []
  if (useTls.value) {
    params.push('tls=true')
    if (tlsCaFile.value) params.push(`tlsCAFile=${encodeURIComponent(tlsCaFile.value)}`)
    if (tlsCertKeyFile.value) params.push(`tlsCertificateKeyFile=${encodeURIComponent(tlsCertKeyFile.value)}`)
    if (tlsAllowInvalidCerts.value) params.push('tlsAllowInvalidCertificates=true')
  }
  // OIDC needs its mechanism in the test URI (other mechanisms negotiate via credentials).
  if (authMode.value === 'OIDC') {
    params.push('authMechanism=MONGODB-OIDC')
  }
  // Advanced-tab options, appended verbatim to mirror the backend's passthrough.
  for (const [key, value] of Object.entries(buildOptions())) {
    params.push(`${key}=${value}`)
  }
  if (params.length) uri += `?${params.join('&')}`
  return uri
}

// Parses a pasted MongoDB URI into the form fields so the user can review and
// adjust before saving. Hand-rolled rather than relying on the browser's URL
// parser, which throws on a multi-host seed list (`host1,host2,…`) — the
// standard replica-set / cluster format. Returns true if `raw` looked like a
// MongoDB connection string.
function parseUri(raw) {
  const scheme = raw.match(/^mongodb(\+srv)?:\/\//)
  if (!scheme) return false
  const isSrv = !!scheme[1]
  let rest = raw.slice(scheme[0].length)

  // Peel off the query string (everything after the first '?').
  let queryStr = ''
  const qIdx = rest.indexOf('?')
  if (qIdx !== -1) {
    queryStr = rest.slice(qIdx + 1)
    rest = rest.slice(0, qIdx)
  }

  // Peel off the optional /database path (first '/').
  let dbPath = ''
  const slashIdx = rest.indexOf('/')
  if (slashIdx !== -1) {
    dbPath = rest.slice(slashIdx + 1)
    rest = rest.slice(0, slashIdx)
  }

  // Split userinfo from hosts at the LAST '@' so an unescaped '@' inside a
  // password is tolerated — the host portion never contains '@'.
  let userInfo = ''
  let hostsPart = rest
  const atIdx = rest.lastIndexOf('@')
  if (atIdx !== -1) {
    userInfo = rest.slice(0, atIdx)
    hostsPart = rest.slice(atIdx + 1)
  }

  const decode = (s) => { try { return decodeURIComponent(s) } catch (_) { return s } }

  if (userInfo) {
    const cIdx = userInfo.indexOf(':')
    if (cIdx === -1) {
      username.value = decode(userInfo)
      password.value = ''
    } else {
      username.value = decode(userInfo.slice(0, cIdx))
      password.value = decode(userInfo.slice(cIdx + 1))
    }
  }

  // Parse the comma-separated seed list. host:port splits at the last ':' to
  // leave IPv6 brackets alone. SRV uses a single hostname with no port.
  const list = hostsPart.split(',').filter(Boolean)
  if (isSrv) {
    hosts.value = [{ host: list[0] || 'localhost', port: 27017 }]
  } else if (list.length) {
    hosts.value = list.map((hp) => {
      const colonIdx = hp.lastIndexOf(':')
      if (colonIdx === -1 || hp.includes(']')) {
        return { host: hp || 'localhost', port: 27017 }
      }
      return {
        host: hp.slice(0, colonIdx) || 'localhost',
        port: parseInt(hp.slice(colonIdx + 1)) || 27017,
      }
    })
  } else {
    hosts.value = [{ host: 'localhost', port: 27017 }]
  }

  connType.value = isSrv ? 'srv' : 'standalone'
  authDb.value = decode(dbPath) || 'admin'

  const params = new URLSearchParams(queryStr)
  const rs = params.get('replicaSet')
  if (rs) {
    connType.value = 'replica'
    replicaSetName.value = rs
  }
  const authSource = params.get('authSource')
  if (authSource) authDb.value = authSource

  const mech = params.get('authMechanism')
  if (mech) {
    const mechMap = { 'MONGODB-X509': 'X509', 'MONGODB-AWS': 'AWS', 'MONGODB-OIDC': 'OIDC' }
    authMode.value = mechMap[mech] || mech
  } else if (!username.value) {
    authMode.value = 'none'
  }

  // Recover OIDC environment / token resource from authMechanismProperties so an imported
  // OIDC string round-trips (buildOptions re-emits it from these fields on save).
  if (authMode.value === 'OIDC') {
    const amp = params.get('authMechanismProperties') || ''
    for (const part of amp.split(',')) {
      const idx = part.indexOf(':')
      if (idx === -1) continue
      const key = part.slice(0, idx).trim()
      const value = part.slice(idx + 1).trim()
      if (key === 'ENVIRONMENT') oidcEnvironment.value = value || 'azure'
      if (key === 'TOKEN_RESOURCE') oidcTokenResource.value = value
    }
  }

  if (params.get('tls') === 'true' || params.get('ssl') === 'true') {
    useTls.value = true
    if (params.get('tlsAllowInvalidCertificates') === 'true') tlsAllowInvalidCerts.value = true
  }

  // Route every remaining option so the import preserves it (Studio 3T parity): catalog
  // keys fill the Advanced tab, read preference / TLS files fill their dedicated fields,
  // and anything else is kept verbatim to be re-emitted on save.
  const routed = partitionUriOptions(params, KNOWN_OPTION_KEYS)
  Object.assign(advancedOptions.value, routed.known)
  importedExtraOptions.value = routed.extra
  if (routed.readPreference) readPreference.value = routed.readPreference
  if (routed.tlsCaFile) tlsCaFile.value = routed.tlsCaFile
  if (routed.tlsCertKeyFile) tlsCertKeyFile.value = routed.tlsCertKeyFile
  if (routed.tls) useTls.value = true

  return true
}

function goNext() {
  if (mode.value === 'uri') {
    const raw = pastedUri.value.trim()
    if (!raw) {
      uriError.value = 'Paste a connection string, or choose "Manually configure" below.'
      return
    }
    if (!parseUri(raw)) {
      uriError.value = 'That doesn’t look like a MongoDB connection string (expected mongodb:// or mongodb+srv://).'
      return
    }
    connName.value = 'Imported from URI'
  }
  uriError.value = ''
  step.value = 'form'
  activeTab.value = 'server'
}

async function testConnection() {
  status.value = null
  isTesting.value = true
  try {
    if (useSsh.value) {
      await invoke('test_ssh_connection', {
        sshHost:       sshHost.value,
        sshPort:       Number(sshPort.value) || 22,
        sshUser:       sshUser.value,
        sshAuth:       sshAuth.value,
        sshPassword:   sshPassword.value || null,
        sshKeyFile:    sshKeyFile.value || null,
        sshPassphrase: sshKeyPassphrase.value || null,
        mongoHost:     hosts.value[0].host,
        mongoPort:     Number(hosts.value[0].port) || 27017,
        username:      authMode.value !== 'none' ? (username.value || null) : null,
        password:      authMode.value !== 'none' ? (password.value || null) : null,
        authDb:        authMode.value !== 'none' ? (authDb.value || null) : null,
        authMechanism: authMode.value,
      })
    } else {
      await invoke('test_connection', { uri: buildUriForTest() })
    }
    status.value = { type: 'success', message: 'Connected successfully.' }
  } catch (e) {
    status.value = { type: 'error', message: errText(e) }
  } finally {
    isTesting.value = false
  }
}

async function save() {
  if (!connName.value.trim()) {
    status.value = { type: 'error', message: 'Connection name is required.' }
    return
  }
  status.value = null
  isSaving.value = true
  try {
    const fields = {
      name:            connName.value.trim(),
      hosts:           hosts.value.map(h => ({ host: h.host, port: Number(h.port) || 27017 })),
      connectionType:  connType.value,
      replicaSetName:  replicaSetName.value || null,
      options:         buildOptions(),
      username:        authMode.value !== 'none' ? (username.value || null) : null,
      password:        authMode.value !== 'none' ? (password.value || null) : null,
      authDb:          authMode.value !== 'none' ? (authDb.value || null) : null,
      authMechanism:   authMode.value,
      tls:                          useTls.value,
      tlsCaFile:                    useTls.value ? (tlsCaFile.value || null) : null,
      tlsCertKeyFile:               useTls.value ? (tlsCertKeyFile.value || null) : null,
      tlsAllowInvalidCertificates:  useTls.value ? tlsAllowInvalidCerts.value : false,
      sshEnabled:    useSsh.value,
      sshHost:       useSsh.value ? (sshHost.value || null) : null,
      sshPort:       Number(sshPort.value) || 22,
      sshUser:       useSsh.value ? (sshUser.value || null) : null,
      sshAuth:       useSsh.value ? sshAuth.value : null,
      sshKeyFile:    (useSsh.value && sshAuth.value === 'key') ? (sshKeyFile.value || null) : null,
      sshPassword:   (useSsh.value && sshAuth.value === 'password') ? (sshPassword.value || null) : null,
      sshPassphrase: (useSsh.value && sshAuth.value === 'key') ? (sshKeyPassphrase.value || null) : null,
      tag:             selectedTag.value !== 'none' ? selectedTag.value : null,
      readOnly:        readOnly.value,
    }

    if (isEditMode) {
      await invoke('update_connection', { id: props.editConn.id, ...fields })
      const updated = {
        ...props.editConn,
        name:            fields.name,
        hosts:           fields.hosts,
        connection_type: fields.connectionType,
        replica_set_name: fields.replicaSetName,
        options:         fields.options,
        username:        fields.username,
        auth_db:         fields.authDb,
        auth_mechanism:  fields.authMechanism,
        tls:                            fields.tls,
        tls_ca_file:                    fields.tlsCaFile,
        tls_cert_key_file:              fields.tlsCertKeyFile,
        tls_allow_invalid_certificates: fields.tlsAllowInvalidCertificates,
        ssh_enabled:  fields.sshEnabled,
        ssh_host:     fields.sshHost,
        ssh_port:     fields.sshPort,
        ssh_user:     fields.sshUser,
        ssh_auth:     fields.sshAuth,
        ssh_key_file: fields.sshKeyFile,
        tag:             fields.tag,
        read_only:       fields.readOnly,
      }
      emit('updated', updated)
    } else {
      const id = await invoke('save_connection', fields)
      const conn = {
        id:              id,
        name:            fields.name,
        hosts:           fields.hosts,
        connection_type: fields.connectionType,
        options:         fields.options,
        tag:             fields.tag,
        read_only:       fields.readOnly,
        last_accessed:   null,
      }
      emit('saved', conn)
      await tauriEmit('connection-saved', conn)
    }
  } catch (e) {
    status.value = { type: 'error', message: errText(e) }
    isSaving.value = false
  }
}
</script>

<template>
  <!-- ── Intro step ─────────────────────────────────── -->
  <BaseModal v-if="step === 'intro'" title="New Connection" width="640px" max-width="94vw" @close="$emit('close')">
      <div class="nci-body">
        <p class="nci-lead">
          If you have a connection string (SRV or standard), e.g. for your MongoDB deployment,
          you can paste it here and OzenDB will auto-configure your connection settings for you.
        </p>

        <label class="nci-radio" @click="mode = 'uri'">
          <span class="radio" :class="{ on: mode === 'uri' }"></span>
          <span class="nci-radio-lbl">Paste your connection string (SRV or standard) here:</span>
        </label>
        <div class="nci-uri-wrap">
          <span class="nci-uri-lbl">URI:</span>
          <BaseTextarea
            class="nci-uri"
            :disabled="mode !== 'uri'"
            v-model="pastedUri"
            placeholder="mongodb+srv://user:password@cluster.mongodb.net/"
          />
        </div>

        <FieldError :text="uriError" class="nci-error" />

        <label class="nci-radio" @click="mode = 'manual'; uriError = ''">
          <span class="radio" :class="{ on: mode === 'manual' }"></span>
          <span class="nci-radio-lbl">Manually configure my connection settings</span>
        </label>
      </div>

      <div class="cm-footer">
        <span class="spacer"></span>
        <BaseButton bordered @click="$emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" @click="goNext">Next</BaseButton>
      </div>
  </BaseModal>

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
      <div class="nc-body">

        <!-- Server -->
        <div v-if="activeTab === 'server'" class="nc-form">
          <FormField label="Connection type">
            <SegmentedControl
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
            <BaseSelect class="nc-sel" v-model="authMode" :options="authModeOptions">
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
        <BaseButton variant="primary" :disabled="isSaving" @click="save">
          {{ isSaving ? 'Saving…' : (isEditMode ? 'Save Changes' : 'Save') }}
        </BaseButton>
      </div>

  </BaseModal>
</template>

<style src="./NewConnection.css" scoped></style>
