import { ref, computed } from 'vue'
import { testConnection as testConnectionApi, testSshConnection, saveConnection, updateConnection } from '../engines/mongodb/api/connections'
import { emit as tauriEmit } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { errText } from '../utils/errors'
import { connectionTargetChanged } from '../utils/connectionTarget.js'
import { hasLoadedData } from '../stores/connectionData.js'
import { OPTION_GROUPS, KNOWN_OPTION_KEYS } from '../data/connectionOptions.js'

// Options managed by dedicated fields outside the catalog (so they aren't treated as
// "unknown" passthrough below).
const DEDICATED_OPTION_KEYS = ['readPreference']

/**
 * One connection editor's fields and the two things you can do with them: test the
 * connection, and save it. Called once per dialog — the refs are per-instance.
 *
 * `save()` returns the stored connection and broadcasts it, but does not emit: the
 * component owns its own events.
 *
 * @param {Object|null} editConn - the connection being edited, or null when creating.
 */
export function useConnectionForm(editConn) {
  const isEditMode = !!editConn

  const connName = ref(isEditMode ? editConn.name : 'New Connection')

  // Seed list — always at least one { host, port } row. In edit mode it comes from the
  // stored config (already a `hosts` array after backend migration).
  const hosts = ref(
    isEditMode && Array.isArray(editConn.hosts) && editConn.hosts.length
      ? editConn.hosts.map(h => ({ host: h.host, port: h.port }))
      : [{ host: 'localhost', port: 27017 }]
  )
  const connType       = ref(isEditMode ? editConn.connection_type : 'standalone')
  const replicaSetName = ref(isEditMode ? (editConn.replica_set_name ?? '') : '')

  // Read preference lives on the Server tab (not Advanced) because it only makes sense
  // for replica sets / sharded / SRV. '' means unset → driver default (primary). Stored
  // in the connection's `options` map like other URI params.
  const readPreference = ref(
    (isEditMode && editConn.options) ? (editConn.options.readPreference ?? '') : ''
  )

  // Only replica sets and sharded clusters use a multi-host seed list; standalone and
  // SRV are single-host.
  const isMultiHost = computed(() => connType.value === 'replica' || connType.value === 'sharded')

  function addHost() { hosts.value.push({ host: '', port: 27017 }) }
  function removeHost(index) { if (hosts.value.length > 1) hosts.value.splice(index, 1) }

  // auth
  const authMode = ref(isEditMode ? (editConn.auth_mechanism ?? 'SCRAM-SHA-256') : 'SCRAM-SHA-256')
  const username = ref(isEditMode ? (editConn.username ?? '') : '')
  const password = ref('')   // never pre-filled — empty means "keep existing"
  const authDb   = ref(isEditMode ? (editConn.auth_db ?? 'admin') : 'admin')

  // OIDC (MONGODB-OIDC) workload/machine identity: the driver acquires the token from
  // the cloud environment, so there's no username/password.
  const oidcEnvironment = ref('azure')
  const oidcTokenResource = ref('')
  const oidcNeedsResource = computed(
    () => oidcEnvironment.value === 'azure' || oidcEnvironment.value === 'gcp'
  )

  // In edit mode, recover the OIDC settings from the stored authMechanismProperties
  // string (e.g. "ENVIRONMENT:azure,TOKEN_RESOURCE:api://abc"). Split each pair on its
  // FIRST colon so a resource value containing ':' (like a URL) survives.
  if (isEditMode && editConn.auth_mechanism === 'OIDC' && editConn.options) {
    const amp = editConn.options.authMechanismProperties || ''
    for (const part of amp.split(',')) {
      const idx = part.indexOf(':')
      if (idx === -1) continue
      const key = part.slice(0, idx).trim()
      const value = part.slice(idx + 1).trim()
      if (key === 'ENVIRONMENT') oidcEnvironment.value = value || 'azure'
      if (key === 'TOKEN_RESOURCE') oidcTokenResource.value = value
    }
  }

  // The authMechanismProperties string the driver needs for the selected environment.
  function oidcMechanismProperties() {
    let properties = `ENVIRONMENT:${oidcEnvironment.value}`
    if (oidcNeedsResource.value && oidcTokenResource.value.trim()) {
      properties += `,TOKEN_RESOURCE:${oidcTokenResource.value.trim()}`
    }
    return properties
  }

  // ssl
  const useTls               = ref(isEditMode ? !!editConn.tls : false)
  const tlsCaFile            = ref(isEditMode ? (editConn.tls_ca_file ?? '') : '')
  const tlsCertKeyFile       = ref(isEditMode ? (editConn.tls_cert_key_file ?? '') : '')
  const tlsAllowInvalidCerts = ref(isEditMode ? !!editConn.tls_allow_invalid_certificates : false)

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

  // ssh
  const useSsh           = ref(isEditMode ? !!editConn.ssh_enabled : false)
  const sshHost          = ref(isEditMode ? (editConn.ssh_host ?? '') : '')
  const sshPort          = ref(isEditMode ? (editConn.ssh_port ?? 22) : 22)
  const sshUser          = ref(isEditMode ? (editConn.ssh_user ?? '') : '')
  const sshAuth          = ref(isEditMode ? (editConn.ssh_auth ?? 'password') : 'password')
  const sshPassword      = ref('')   // never pre-filled — empty means "keep existing"
  const sshKeyFile       = ref(isEditMode ? (editConn.ssh_key_file ?? '') : '')
  const sshKeyPassphrase = ref('')   // never pre-filled

  async function pickSshKey() {
    try {
      const picked = await openDialog({ multiple: false })
      if (typeof picked === 'string') sshKeyFile.value = picked
    } catch (_) {}
  }

  const selectedTag = ref(isEditMode ? (editConn.tag ?? 'none') : 'none')

  // Read-only connection: when set, the backend refuses every mutating operation
  // against this connection (a real lock, see client_for_write in Rust).
  const readOnly = ref(isEditMode ? !!editConn.read_only : false)

  // Connection-string options (the Advanced tab). Each catalog key maps to a string
  // value; '' means "unset", so the driver default applies.
  const storedOptions = (isEditMode && editConn.options) ? editConn.options : {}
  const advancedOptions = ref(
    Object.fromEntries(
      KNOWN_OPTION_KEYS.map(key => [
        key,
        storedOptions[key] != null ? String(storedOptions[key]) : '',
      ])
    )
  )

  // Any stored option without a dedicated field (e.g. a key added by a future driver,
  // or hand-edited JSON) is preserved verbatim so saving never drops it.
  const extraOptions = Object.fromEntries(
    Object.entries(storedOptions).filter(
      ([key]) => !KNOWN_OPTION_KEYS.includes(key) && !DEDICATED_OPTION_KEYS.includes(key)
    )
  )

  // Unknown options captured when importing a connection string. Kept reactive so
  // buildOptions carries them through on save — an imported URI never loses a
  // parameter, matching Studio 3T's import.
  const importedExtraOptions = ref({})

  // maxStalenessSeconds / readPreferenceTags are only valid alongside a non-primary
  // read preference; the driver rejects the whole URI otherwise. Standalone has no
  // read preference at all.
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

  // Assembles the options map sent to the backend: every set, visible, enabled field
  // plus any preserved unknown options. Disabled/hidden/empty are omitted so the built
  // URI only ever carries valid, driver-accepted parameters.
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

  const status    = ref(null)
  const isTesting = ref(false)
  const isSaving  = ref(false)
  // Set when an edit was refused because the connection is live, which is what puts
  // the "Save as new connection" action on the footer.
  const blockedByLiveConnection = ref(false)

  // The form as the backend takes it — shared by Save and Test Connection, so both
  // describe the same connection and the test can't pass on a URI Save wouldn't produce.
  function formFields() {
    return {
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
  }

  // Pre-fills the form from a connection string parsed by the intro step. A null field
  // means the string said nothing about it, so the form keeps its own default.
  function applyParsed(parsed) {
    connName.value = 'Imported from URI'
    const set = (field, value) => { if (value !== null) field.value = value }

    set(username, parsed.username)
    set(password, parsed.password)
    set(hosts, parsed.hosts)
    set(connType, parsed.connectionType)
    set(replicaSetName, parsed.replicaSetName)
    set(authDb, parsed.authDb)
    set(authMode, parsed.authMode)
    set(oidcEnvironment, parsed.oidcEnvironment)
    set(oidcTokenResource, parsed.oidcTokenResource)
    set(useTls, parsed.tls)
    set(tlsAllowInvalidCerts, parsed.tlsAllowInvalidCerts)
    set(tlsCaFile, parsed.tlsCaFile)
    set(tlsCertKeyFile, parsed.tlsCertKeyFile)
    set(readPreference, parsed.readPreference)
    Object.assign(advancedOptions.value, parsed.advancedOptions)
    importedExtraOptions.value = parsed.extraOptions
  }

  // A tunnelled connection is tested through a temporary tunnel, which the backend
  // opens from the SSH fields directly rather than from a connection string.
  async function testConnection() {
    status.value = null
    isTesting.value = true
    try {
      if (useSsh.value) {
        await testSshConnection({
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
        await testConnectionApi(isEditMode ? editConn.id : null, formFields())
      }
      status.value = { type: 'success', message: 'Connected successfully.' }
    } catch (e) {
      status.value = { type: 'error', message: errText(e) }
    } finally {
      isTesting.value = false
    }
  }

  /**
   * Persist the form and broadcast the result app-wide, so the sidebar and the
   * Connection Manager refresh their own copies.
   *
   * @returns {Promise<{event: string, conn: Object}|null>} the event the component
   *   should emit and its payload, or null when the save was refused or failed — the
   *   reason is in `status`.
   */
  async function save() {
    if (!connName.value.trim()) {
      status.value = { type: 'error', message: 'Connection name is required.' }
      return null
    }
    status.value = null
    isSaving.value = true
    blockedByLiveConnection.value = false

    try {
      const fields = formFields()
      if (isEditMode) {
        if (connectionTargetChanged(editConn, fields) && hasLoadedData(editConn.id)) {
          status.value = {
            type: 'error',
            message: `${editConn.name} is open in the sidebar. Pointing it at a different `
              + 'server would leave the databases listed there describing the old one — '
              + 'disconnect it first, or save these settings as a new connection.',
          }
          blockedByLiveConnection.value = true
          isSaving.value = false
          return null
        }
        const conn = await updateConnection(editConn.id, fields)
        await tauriEmit('connection-updated', conn)
        return { event: 'updated', conn: conn }
      }

      return await create(fields)
    } catch (e) {
      status.value = { type: 'error', message: errText(e) }
      isSaving.value = false
      return null
    }
  }

  /**
   * Save the current form as a separate connection, leaving the edited one untouched.
   * Offered when an edit is refused because the connection is live.
   */
  async function saveAsNew() {
    status.value = null
    isSaving.value = true
    try {
      const fields = formFields()
      // Same name as the connection it came from would be indistinguishable in the
      // list; "(copy)" matches what duplicating a connection produces.
      if (isEditMode && fields.name === editConn.name) {
        fields.name = `${fields.name} (copy)`
      }
      // Secret fields are blank unless retyped, and a copy has nothing stored under its
      // own id yet — so it inherits the original's rather than authenticating as nobody.
      return await create(fields, editConn.id)
    } catch (e) {
      status.value = { type: 'error', message: errText(e) }
      isSaving.value = false
      return null
    }
  }

  async function create(fields, copySecretsFrom = null) {
    const id = await saveConnection(fields, copySecretsFrom)
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
    await tauriEmit('connection-saved', conn)
    return { event: 'saved', conn: conn }
  }

  return {
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
    buildOptions, formFields, applyParsed, testConnection, save, saveAsNew,
  }
}
