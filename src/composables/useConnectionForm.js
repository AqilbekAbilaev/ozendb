import { ref } from 'vue'
import { testConnection as testConnectionApi, saveConnection, updateConnection } from '../appApi/connections'
import { emit as tauriEmit } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { errText } from '../utils/errors'
import { connectionTargetChanged } from '../utils/connectionTarget.js'
import { hasLoadedData } from '../stores/connectionData.js'
import { BUILD_FIELDS } from '../engines/connectionFields.js'
import { useMongoFields } from '../engines/mongodb/connection/useMongoFields.js'

const DEFAULT_PORTS = { mongodb: 27017, postgresql: 5432 }

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
  const engine   = ref(isEditMode ? (editConn.engine ?? 'mongodb') : 'mongodb')
  const database = ref(isEditMode ? (editConn.database ?? '') : '')

  // Seed list — always at least one { host, port } row. In edit mode it comes from the
  // stored config (already a `hosts` array after backend migration).
  const hosts = ref(
    isEditMode && Array.isArray(editConn.hosts) && editConn.hosts.length
      ? editConn.hosts.map(h => ({ host: h.host, port: h.port }))
      : [{ host: 'localhost', port: DEFAULT_PORTS[engine.value] }]
  )
  function addHost() { hosts.value.push({ host: '', port: DEFAULT_PORTS[engine.value] }) }

  // A port still at the old engine's default follows the switch; a typed one stays.
  function setEngine(next) {
    for (const h of hosts.value) {
      if (Number(h.port) === DEFAULT_PORTS[engine.value]) h.port = DEFAULT_PORTS[next]
    }
    engine.value = next
  }
  function removeHost(index) { if (hosts.value.length > 1) hosts.value.splice(index, 1) }

  // auth
  const username = ref(isEditMode ? (editConn.username ?? '') : '')
  const password = ref('')   // never pre-filled — empty means "keep existing"

  const mongo = useMongoFields(editConn, { pickCertificate })

  // ssl
  const useTls               = ref(isEditMode ? !!editConn.tls : false)
  const tlsCaFile            = ref(isEditMode ? (editConn.tls_ca_file ?? '') : '')
  const tlsAllowInvalidCerts = ref(isEditMode ? !!editConn.tls_allow_invalid_certificates : false)

  // The chosen certificate's path, or null when the picker was dismissed.
  async function pickCertificate() {
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: 'Certificate', extensions: ['pem', 'crt', 'cert', 'cer', 'key'] }],
      })
      return typeof picked === 'string' ? picked : null
    } catch (_) {
      return null
    }
  }

  async function pickTlsFile() {
    const picked = await pickCertificate()
    if (picked) tlsCaFile.value = picked
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
      engine:          engine.value,
      hosts:           hosts.value.map(h => ({ host: h.host, port: Number(h.port) || DEFAULT_PORTS[engine.value] })),
      tls:                          useTls.value,
      tlsCaFile:                    useTls.value ? (tlsCaFile.value || null) : null,
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
      ...BUILD_FIELDS[engine.value]({
        database:       database.value,
        connType:       mongo.connType.value,
        replicaSetName: mongo.replicaSetName.value,
        // A getter, so only an engine that reads options pays for building them.
        get options() { return mongo.buildOptions() },
        authMode:       mongo.authMode.value,
        username:       username.value,
        password:       password.value,
        authDb:         mongo.authDb.value,
        useTls:         useTls.value,
        tlsCertKeyFile: mongo.tlsCertKeyFile.value,
      }),
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
    set(useTls, parsed.tls)
    set(tlsAllowInvalidCerts, parsed.tlsAllowInvalidCerts)
    set(tlsCaFile, parsed.tlsCaFile)
    mongo.applyParsed(parsed)
  }

  async function testConnection() {
    status.value = null
    isTesting.value = true
    try {
      await testConnectionApi(isEditMode ? editConn.id : null, formFields())
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
      engine:          fields.engine,
      database:        fields.database,
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
    isEditMode, connName, engine, database, setEngine, hosts,
    addHost, removeHost,
    username, password,
    useTls, tlsCaFile, tlsAllowInvalidCerts, pickTlsFile,
    useSsh, sshHost, sshPort, sshUser, sshAuth, sshPassword, sshKeyFile,
    sshKeyPassphrase, pickSshKey,
    selectedTag, readOnly,
    status, isTesting, isSaving, blockedByLiveConnection,
    formFields, testConnection, save, saveAsNew,
    ...mongo,
    // After the spread: the form's own applyParsed calls mongo's.
    applyParsed,
  }
}
