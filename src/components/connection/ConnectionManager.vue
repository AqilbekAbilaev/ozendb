<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit as tauriEmit } from '@tauri-apps/api/event'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { errText } from '../../utils/errors'
import { colorHex } from '../../utils/tabColor.js'
import { useConfirmDelete } from '../../composables/useConfirmDelete'
import { useToast } from '../../composables/useToast'
import BaseIcon from '../base/BaseIcon.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import ToolbarButton from '../base/ToolbarButton.vue'
import NewConnection from './NewConnection.vue'
import ContextMenu from '../base/ContextMenu.vue'
import { formatNow } from '../../utils/format'

const emit = defineEmits(['close', 'connect'])
const { showToast } = useToast()

const connections = ref([])
const selectedId = ref(null)
const filterText = ref('')
const showOnStartup     = ref(false)
const showNewConnection = ref(false)
const showEditConnection = ref(false)

// --- Folders (Connection Manager grouping) ---
const folders          = ref([])
const expandedFolders  = ref([])      // folder ids currently expanded (default: all)
const renamingFolderId = ref(null)
const renameText       = ref('')
const { pendingId: pendingDeleteId, confirmDelete, reset: resetDelete } = useConfirmDelete()
const ctxMenu          = ref(null)    // { x, y, connId } for the move-to-folder context menu

onMounted(async () => {
  connections.value = await invoke('list_connections')
  folders.value = await invoke('list_folders')
  expandedFolders.value = folders.value.map(f => f.id)  // start expanded
  listen('connection-saved', (e) => {
    if (!connections.value.find(c => c.id === e.payload.id))
      connections.value.push(e.payload)
  })
})

const filtered = computed(() => {
  const q = filterText.value.toLowerCase()
  if (!q) return connections.value
  return connections.value.filter(c =>
    c.name.toLowerCase().includes(q) || parseDbServer(c).toLowerCase().includes(q)
  )
})


function parseDbServer(conn) {
  const hosts = conn.hosts ?? []
  if (!hosts.length) return '—'
  const first = hosts[0]
  if (conn.connection_type === 'srv') return first.host
  const label = `${first.host}:${first.port}`
  return hosts.length > 1 ? `${label} +${hosts.length - 1}` : label
}

function parseSecurity(conn) {
  if (!conn.username) return null
  const db = conn.auth_db || 'admin'
  return `${conn.username} @ ${db}`
}


function newConnection() {
  showNewConnection.value = true
}

function editSelected() {
  if (!selectedId.value) return
  showEditConnection.value = true
}

function onConnectionSaved(conn) {
  if (!connections.value.find(c => c.id === conn.id)) {
    connections.value.push(conn)
  }
  showNewConnection.value = false
}

function onConnectionUpdated(conn) {
  const idx = connections.value.findIndex(c => c.id === conn.id)
  if (idx !== -1) connections.value.splice(idx, 1, conn)
  showEditConnection.value = false
}

async function deleteSelected() {
  if (!selectedId.value) return
  const deletedId = selectedId.value
  await invoke('delete_connection', { id: deletedId })
  connections.value = connections.value.filter(c => c.id !== deletedId)
  selectedId.value = null
  // Tell the sidebar to drop it too if it was open (mirrors connection-saved).
  await tauriEmit('connection-deleted', { id: deletedId })
}

async function connectSelected() {
  if (!selectedId.value) return
  const now = formatNow()
  try {
    await invoke('update_last_accessed', { id: selectedId.value, timestamp: now })
    const conn = connections.value.find(c => c.id === selectedId.value)
    if (conn) conn.last_accessed = now
  } catch {}
  emit('connect', selectedId.value)
}

async function duplicateSelected() {
  if (!selectedId.value) return
  try {
    const copy = await invoke('duplicate_connection', { id: selectedId.value })
    connections.value.push(copy)
    selectedId.value = copy.id
    showToast(`Duplicated as "${copy.name}"`)
  } catch (e) {
    showToast('Duplicate failed: ' + errText(e))
  }
}

async function copyUri() {
  if (!selectedId.value) return
  try {
    const uri = await invoke('connection_uri', { id: selectedId.value })
    await navigator.clipboard.writeText(uri)
    showToast('Connection URI copied (password excluded)')
  } catch (e) {
    showToast('To URI failed: ' + errText(e))
  }
}

async function exportConnections() {
  let path
  try {
    path = await saveDialog({
      defaultPath: 'connections.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
  } catch (e) {
    showToast('Export failed: ' + errText(e))
    return
  }
  if (!path) return  // user cancelled
  try {
    const count = await invoke('export_connections', { path: path })
    showToast(`Exported ${count} connection${count !== 1 ? 's' : ''} (passwords excluded)`)
  } catch (e) {
    showToast('Export failed: ' + errText(e))
  }
}

async function importConnections() {
  let path
  try {
    path = await openDialog({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
  } catch (e) {
    showToast('Import failed: ' + errText(e))
    return
  }
  if (!path) return  // user cancelled
  try {
    const count = await invoke('import_connections', { path: String(path) })
    connections.value = await invoke('list_connections')
    showToast(`Imported ${count} connection${count !== 1 ? 's' : ''} — re-enter passwords to connect`)
  } catch (e) {
    showToast('Import failed: ' + errText(e))
  }
}

// --- Folder grouping ---
const isFiltering = computed(() => filterText.value.trim().length > 0)

const validFolderIds = computed(() => new Set(folders.value.map(f => f.id)))

// Connections grouped by their folder id (only valid, existing folders count).
const connsByFolder = computed(() => {
  const m = new Map()
  for (const c of connections.value) {
    if (c.folder_id && validFolderIds.value.has(c.folder_id)) {
      if (!m.has(c.folder_id)) m.set(c.folder_id, [])
      m.get(c.folder_id).push(c)
    }
  }
  return m
})

// Connections at the root: no folder, or a folder that no longer exists.
const rootConns = computed(() =>
  connections.value.filter(c => !c.folder_id || !validFolderIds.value.has(c.folder_id))
)

function isExpanded(id) { return expandedFolders.value.includes(id) }

function toggleFolder(id) {
  resetDelete()
  const i = expandedFolders.value.indexOf(id)
  if (i === -1) expandedFolders.value.push(id)
  else expandedFolders.value.splice(i, 1)
}

// An ordered flat list of rows to render: folder headers, their connections
// (when expanded), then the root connections. While filtering, a flat list of
// matches with no folder headers.
const displayRows = computed(() => {
  if (isFiltering.value) {
    return filtered.value.map(c => ({ type: 'conn', conn: c, indent: false }))
  }
  const rows = []
  for (const f of folders.value) {
    const kids = connsByFolder.value.get(f.id) ?? []
    rows.push({ type: 'folder', folder: f, count: kids.length })
    if (isExpanded(f.id)) {
      if (kids.length === 0) rows.push({ type: 'empty', key: 'empty-' + f.id })
      else for (const c of kids) rows.push({ type: 'conn', conn: c, indent: true })
    }
  }
  for (const c of rootConns.value) rows.push({ type: 'conn', conn: c, indent: false })
  return rows
})

// Create a folder with a unique default name and expand it.
async function createUniqueFolder() {
  const base = 'New Folder'
  const existing = new Set(folders.value.map(f => f.name))
  let name = base
  let n = 2
  while (existing.has(name)) name = `${base} ${n++}`
  const folder = await invoke('create_folder', { name: name })
  folders.value.push(folder)
  expandedFolders.value.push(folder.id)
  return folder
}

async function newFolder() {
  // Create, then drop straight into inline rename.
  try {
    startRenameFolder(await createUniqueFolder())
  } catch (e) {
    showToast('Create folder failed: ' + errText(e))
  }
}

function startRenameFolder(f) {
  renamingFolderId.value = f.id
  renameText.value = f.name
  nextTick(() => {
    const el = document.querySelector('.folder-rename-input')
    if (el) { el.focus(); el.select() }
  })
}

async function commitRenameFolder(f) {
  const name = renameText.value.trim()
  renamingFolderId.value = null
  if (!name || name === f.name) return
  try {
    await invoke('rename_folder', { id: f.id, name: name })
    const target = folders.value.find(x => x.id === f.id)
    if (target) target.name = name
  } catch (e) {
    showToast('Rename failed: ' + errText(e))
  }
}

function cancelRenameFolder() {
  renamingFolderId.value = null
}

async function deleteFolder(f) {
  if (!confirmDelete(f.id)) return
  try {
    await invoke('delete_folder', { id: f.id })
    folders.value = folders.value.filter(x => x.id !== f.id)
    // Connections inside were moved back to root server-side; reload to reflect.
    connections.value = await invoke('list_connections')
  } catch (e) {
    showToast('Delete folder failed: ' + errText(e))
  }
}

function openMoveMenu(event, conn) {
  selectedId.value = conn.id
  resetDelete()
  ctxMenu.value = { x: event.clientX, y: event.clientY, connId: conn.id }
}

// The items for the reused ContextMenu: remove-from-folder (when applicable),
// the folder list (current folder checked), then a New Folder action.
const moveMenuModel = computed(() => {
  if (!ctxMenu.value) return null
  const conn = connections.value.find(c => c.id === ctxMenu.value.connId)
  const currentId = conn && validFolderIds.value.has(conn.folder_id) ? conn.folder_id : null
  const items = []
  if (currentId) {
    items.push({ label: 'Remove from Folder', icon: 'close', value: 'root' })
    items.push({ sep: true })
  }
  for (const f of folders.value) {
    items.push({
      label: f.name,
      icon: 'folder',
      value: 'f:' + f.id,
      shortcut: f.id === currentId ? '✓' : undefined,
    })
  }
  if (folders.value.length) items.push({ sep: true })
  items.push({ label: 'New Folder…', icon: 'plus', value: 'new' })
  return { x: ctxMenu.value.x, y: ctxMenu.value.y, items: items }
})

async function onMovePick(value) {
  const connId = ctxMenu.value && ctxMenu.value.connId
  ctxMenu.value = null
  if (!connId) return
  if (value === 'new') {
    try {
      const folder = await createUniqueFolder()
      await applyMove(connId, folder.id)
      startRenameFolder(folder)
    } catch (e) {
      showToast('Create folder failed: ' + errText(e))
    }
    return
  }
  const folderId = value === 'root' ? null : value.slice(2)  // strip "f:"
  await applyMove(connId, folderId)
}

async function applyMove(connId, folderId) {
  try {
    await invoke('move_connection_to_folder', { id: connId, folderId: folderId })
    const c = connections.value.find(x => x.id === connId)
    if (c) c.folder_id = folderId
    if (folderId && !isExpanded(folderId)) expandedFolders.value.push(folderId)
  } catch (e) {
    showToast('Move failed: ' + errText(e))
  }
}

const CM_TOOLS = [
  { name: 'newConn',   label: 'New Connection', action: newConnection },
  { name: 'folder',    label: 'New Folder', action: newFolder },
  { sep: true },
  { name: 'edit',      label: 'Edit',   action: editSelected,   needsSel: true },
  { name: 'trash',     label: 'Delete', action: deleteSelected, needsSel: true },
  { name: 'duplicate', label: 'Duplicate', action: duplicateSelected, needsSel: true },
  { sep: true },
  { name: 'import',    label: 'Import', action: importConnections },
  { name: 'export',    label: 'Export', action: exportConnections },
  { name: 'uri',       label: 'To URI', action: copyUri, needsSel: true },
]
</script>

<template>
  <BaseModal title="Connection Manager" width="1180px" max-width="94vw" height="660px" max-height="92vh" @close="$emit('close')">

      <!-- Toolbar -->
      <div class="cm-toolbar">
        <template v-for="(t, i) in CM_TOOLS" :key="i">
          <div v-if="t.sep" class="tb-sep"></div>
          <ToolbarButton
            v-else
            :icon="t.name"
            :label="t.label"
            :off="!t.action || (t.needsSel && !selectedId)"
            :title="t.label"
            @click="t.action && (!t.needsSel || selectedId) && t.action()"
          />
        </template>
      </div>

      <!-- Filter -->
      <div class="cm-filter">
        <BaseInput
          class="fbox"
          v-model="filterText"
          placeholder="Click here to filter connections"
        />
        <span class="matches">{{ filtered.length }} matches</span>
      </div>

      <!-- Grid -->
      <div class="cm-grid">
        <table class="cmt">
          <thead>
            <tr>
              <th style="width:30%">Name</th>
              <th style="width:20%">DB Server</th>
              <th style="width:28%">Security</th>
              <th style="width:16%">Last Accessed</th>
              <th>Shortcut</th>
            </tr>
          </thead>
          <tbody>
            <template
              v-for="row in displayRows"
              :key="row.type === 'conn' ? row.conn.id : (row.key || ('folder-' + row.folder.id))"
            >
              <!-- Folder header -->
              <tr v-if="row.type === 'folder'" class="folder-row" @click="toggleFolder(row.folder.id)">
                <td colspan="5">
                  <div class="folder-head">
                    <BaseIcon
                      :name="isExpanded(row.folder.id) ? 'caretDown' : 'caret'"
                      :size="11"
                      class="folder-caret"
                    />
                    <BaseIcon name="folder" :size="15" class="folder-ic" />
                    <BaseInput
                      v-if="renamingFolderId === row.folder.id"
                      class="folder-rename-input"
                      v-model="renameText"
                      @click.stop
                      @keydown.enter="commitRenameFolder(row.folder)"
                      @keydown.esc.prevent="cancelRenameFolder"
                      @blur="commitRenameFolder(row.folder)"
                    />
                    <span
                      v-else
                      class="folder-name"
                      @dblclick.stop="startRenameFolder(row.folder)"
                    >{{ row.folder.name }}</span>
                    <span class="folder-count">{{ row.count }}</span>
                    <span class="folder-actions" @click.stop>
                      <BaseButton icon="edit" :icon-size="14" title="Rename" @click="startRenameFolder(row.folder)" />
                      <BaseButton
                        icon="trash"
                        :icon-size="14"
                        :variant="pendingDeleteId === row.folder.id ? 'danger' : 'default'"
                        :title="pendingDeleteId === row.folder.id ? 'Click again to delete' : 'Delete folder'"
                        @click="deleteFolder(row.folder)"
                      />
                    </span>
                  </div>
                </td>
              </tr>

              <!-- Empty folder hint -->
              <tr v-else-if="row.type === 'empty'" class="folder-empty-row">
                <td colspan="5">Empty — right-click a connection and choose “Move to folder”.</td>
              </tr>

              <!-- Connection row -->
              <tr
                v-else
                :class="{ sel: row.conn.id === selectedId }"
                @click="selectedId = row.conn.id; resetDelete()"
                @dblclick="editSelected"
                @contextmenu.prevent="openMoveMenu($event, row.conn)"
              >
                <td>
                  <span class="cm-name" :class="{ 'cm-indent': row.indent }">
                    <span
                      class="cm-tag"
                      :style="colorHex(row.conn.tag)
                        ? { background: colorHex(row.conn.tag) }
                        : { background: 'transparent', border: '1px solid var(--border-soft)' }"
                    >
                      <BaseIcon
                        name="dbSmall"
                        :size="12"
                        :style="colorHex(row.conn.tag) ? { color: '#fff' } : { color: 'var(--text-faint)' }"
                      />
                    </span>
                    {{ row.conn.name }}
                  </span>
                </td>
                <td>{{ parseDbServer(row.conn) }}</td>
                <td>
                  <span v-if="parseSecurity(row.conn)" class="cm-key">
                    <BaseIcon name="lock" :size="13" />
                    {{ parseSecurity(row.conn) }}
                  </span>
                  <span v-else class="muted">—</span>
                </td>
                <td><span class="muted">{{ row.conn.last_accessed ?? '—' }}</span></td>
                <td></td>
              </tr>
            </template>

            <tr v-if="displayRows.length === 0">
              <td colspan="5" style="text-align:center;padding:24px;color:var(--text-faint)">
                No connections found.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Footer -->
      <div class="cm-footer">
        <label class="chk-line">
          <span class="cb" :class="{ on: showOnStartup }" @click="showOnStartup = !showOnStartup">
            <BaseIcon v-if="showOnStartup" name="check" :size="12" />
          </span>
          Show on startup
        </label>
        <span class="spacer"></span>
        <BaseButton bordered @click="$emit('close')">Close</BaseButton>
        <BaseButton variant="primary" :disabled="!selectedId" @click="connectSelected">Connect</BaseButton>
      </div>

  </BaseModal>

  <!-- Move-to-folder context menu (reuses the app's ContextMenu) -->
  <ContextMenu
    v-if="moveMenuModel"
    :menu="moveMenuModel"
    @close="ctxMenu = null"
    @pick="onMovePick"
  />

  <!-- New Connection modal -->
  <NewConnection
    v-if="showNewConnection"
    @close="showNewConnection = false"
    @saved="onConnectionSaved"
  />

  <!-- Edit Connection modal -->
  <NewConnection
    v-if="showEditConnection"
    :edit-conn="connections.find(c => c.id === selectedId)"
    @close="showEditConnection = false"
    @updated="onConnectionUpdated"
  />
</template>

<style scoped>
/* ---- toolbar ---- */
.cm-toolbar {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.tb-sep {
  width: 1px;
  background: var(--border-soft);
  margin: 6px 4px;
}

/* ---- filter row ---- */
.cm-filter {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.base-input.fbox { flex: 1; }
.matches { font-size: 12.5px; color: var(--text-dim); white-space: nowrap; }

/* ---- table ---- */
.cm-grid {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

table.cmt {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
table.cmt th {
  position: sticky;
  top: 0;
  background: var(--bg-panel-2);
  color: var(--text);
  text-align: left;
  font-weight: 600;
  padding: 7px 12px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  z-index: 2;
  white-space: nowrap;
}
table.cmt td {
  padding: 8px 12px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  color: var(--text);
  white-space: nowrap;
}
table.cmt tbody tr { cursor: default; user-select: none; }
table.cmt tbody tr:hover:not(.sel) { background: var(--bg-hover); }
table.cmt tr.sel td { background: var(--accent); color: #fff; }
table.cmt tr.sel .muted { color: rgba(255,255,255,.8); }

.cm-name {
  display: flex;
  align-items: center;
  gap: 9px;
}
.cm-tag {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: grid;
  place-items: center;
  flex: none;
}
.cm-key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
}
table.cmt tr.sel .cm-key { color: rgba(255,255,255,.85); }
.muted { color: var(--text-dim); }

/* ---- folders ---- */
.folder-row { cursor: default; user-select: none; }
.folder-row:hover td { background: var(--bg-hover); }
.folder-row td { background: var(--bg-panel-2); }
.folder-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.folder-caret { color: var(--text-dim); flex: none; }
.folder-ic { color: var(--text-dim); flex: none; }
.folder-name { font-weight: 600; color: var(--text); }
.folder-count {
  font-size: 11.5px;
  color: var(--text-dim);
  background: var(--bg-input);
  border-radius: 9px;
  padding: 1px 8px;
}
.base-input.folder-rename-input {
  border: 1px solid var(--accent);
  border-radius: 5px;
  padding: 2px 7px;
  font-weight: 600;
  min-width: 160px;
}
.folder-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
  opacity: 0;
}
.folder-row:hover .folder-actions { opacity: 1; }
.fbtn-danger, 

.cm-indent { padding-left: 22px; }

.folder-empty-row td {
  padding: 6px 12px 6px 44px;
  color: var(--text-faint);
  font-size: 12px;
  font-style: italic;
}

/* ---- footer ---- */
.cm-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex: none;
}
.spacer { flex: 1; }

.chk-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
}
.cb {
  width: 17px; height: 17px;
  border-radius: 4px;
  border: 1px solid var(--border-soft);
  background: var(--bg-input);
  display: grid;
  place-items: center;
  flex: none;
}
.cb.on { background: var(--accent); border-color: var(--accent); color: #fff; }

</style>
