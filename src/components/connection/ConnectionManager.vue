<script setup>
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit as tauriEmit } from '@tauri-apps/api/event'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { errText } from '../../utils/errors'
import { colorHex } from '../../utils/tabColor.js'
import { useToast } from '../../composables/useToast'
import { useConnectionFolders } from '../../composables/useConnectionFolders'
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

onMounted(async () => {
  connections.value = await invoke('list_connections')
  await loadFolders()
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

const {
  renamingFolderId, renameText, pendingDeleteId, resetDelete,
  ctxMenu, displayRows, moveMenuModel, loadFolders, isExpanded, toggleFolder, newFolder,
  startRenameFolder, commitRenameFolder, cancelRenameFolder, deleteFolder, openMoveMenu,
  onMovePick,
} = useConnectionFolders({ connections, selectedId, filterText, filtered, showToast })


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

<style src="./ConnectionManager.css" scoped></style>
