import { computed, nextTick, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listConnections } from '../engines/mongodb/api/connections'
import { errText } from '../utils/errors'
import { useConfirmDelete } from './useConfirmDelete'

export function useConnectionFolders({ connections, selectedId, filterText, filtered, showToast }) {
  const folders = ref([])
  const expandedFolders = ref([])
  const renamingFolderId = ref(null)
  const renameText = ref('')
  const { pendingId: pendingDeleteId, confirmDelete, reset: resetDelete } = useConfirmDelete()
  const ctxMenu = ref(null)

  async function loadFolders() {
    folders.value = await invoke('list_folders')
    expandedFolders.value = folders.value.map(folder => folder.id)
  }

  const isFiltering = computed(() => filterText.value.trim().length > 0)
  const validFolderIds = computed(() => new Set(folders.value.map(folder => folder.id)))
  const connsByFolder = computed(() => {
    const groups = new Map()
    for (const connection of connections.value) {
      if (!connection.folder_id || !validFolderIds.value.has(connection.folder_id)) continue
      if (!groups.has(connection.folder_id)) groups.set(connection.folder_id, [])
      groups.get(connection.folder_id).push(connection)
    }
    return groups
  })
  const rootConnections = computed(() => connections.value.filter(connection =>
    !connection.folder_id || !validFolderIds.value.has(connection.folder_id)
  ))

  function isExpanded(id) {
    return expandedFolders.value.includes(id)
  }

  function toggleFolder(id) {
    resetDelete()
    const index = expandedFolders.value.indexOf(id)
    if (index === -1) expandedFolders.value.push(id)
    else expandedFolders.value.splice(index, 1)
  }

  const displayRows = computed(() => {
    if (isFiltering.value) {
      return filtered.value.map(connection => ({ type: 'conn', conn: connection, indent: false }))
    }
    const rows = []
    for (const folder of folders.value) {
      const children = connsByFolder.value.get(folder.id) ?? []
      rows.push({ type: 'folder', folder, count: children.length })
      if (!isExpanded(folder.id)) continue
      if (!children.length) rows.push({ type: 'empty', key: 'empty-' + folder.id })
      else for (const connection of children) {
        rows.push({ type: 'conn', conn: connection, indent: true })
      }
    }
    for (const connection of rootConnections.value) {
      rows.push({ type: 'conn', conn: connection, indent: false })
    }
    return rows
  })

  async function createUniqueFolder() {
    const base = 'New Folder'
    const existing = new Set(folders.value.map(folder => folder.name))
    let name = base
    let suffix = 2
    while (existing.has(name)) name = `${base} ${suffix++}`
    const folder = await invoke('create_folder', { name })
    folders.value.push(folder)
    expandedFolders.value.push(folder.id)
    return folder
  }

  async function newFolder() {
    try {
      startRenameFolder(await createUniqueFolder())
    } catch (error) {
      showToast('Create folder failed: ' + errText(error))
    }
  }

  function startRenameFolder(folder) {
    renamingFolderId.value = folder.id
    renameText.value = folder.name
    nextTick(() => {
      const input = document.querySelector('.folder-rename-input')
      if (input) {
        input.focus()
        input.select()
      }
    })
  }

  async function commitRenameFolder(folder) {
    const name = renameText.value.trim()
    renamingFolderId.value = null
    if (!name || name === folder.name) return
    try {
      await invoke('rename_folder', { id: folder.id, name })
      const target = folders.value.find(item => item.id === folder.id)
      if (target) target.name = name
    } catch (error) {
      showToast('Rename failed: ' + errText(error))
    }
  }

  function cancelRenameFolder() {
    renamingFolderId.value = null
  }

  async function deleteFolder(folder) {
    if (!confirmDelete(folder.id)) return
    try {
      await invoke('delete_folder', { id: folder.id })
      folders.value = folders.value.filter(item => item.id !== folder.id)
      connections.value = await listConnections()
    } catch (error) {
      showToast('Delete folder failed: ' + errText(error))
    }
  }

  function openMoveMenu(event, connection) {
    selectedId.value = connection.id
    resetDelete()
    ctxMenu.value = { x: event.clientX, y: event.clientY, connId: connection.id }
  }

  const moveMenuModel = computed(() => {
    if (!ctxMenu.value) return null
    const connection = connections.value.find(item => item.id === ctxMenu.value.connId)
    const currentId = connection && validFolderIds.value.has(connection.folder_id)
      ? connection.folder_id
      : null
    const items = []
    if (currentId) {
      items.push({ label: 'Remove from Folder', icon: 'close', value: 'root' })
      items.push({ sep: true })
    }
    for (const folder of folders.value) {
      items.push({
        label: folder.name,
        icon: 'folder',
        value: 'f:' + folder.id,
        shortcut: folder.id === currentId ? '✓' : undefined,
      })
    }
    if (folders.value.length) items.push({ sep: true })
    items.push({ label: 'New Folder…', icon: 'plus', value: 'new' })
    return { x: ctxMenu.value.x, y: ctxMenu.value.y, items }
  })

  async function onMovePick(value) {
    const connId = ctxMenu.value?.connId
    ctxMenu.value = null
    if (!connId) return
    if (value === 'new') {
      try {
        const folder = await createUniqueFolder()
        await applyMove(connId, folder.id)
        startRenameFolder(folder)
      } catch (error) {
        showToast('Create folder failed: ' + errText(error))
      }
      return
    }
    await applyMove(connId, value === 'root' ? null : value.slice(2))
  }

  async function applyMove(connId, folderId) {
    try {
      await invoke('move_connection_to_folder', { id: connId, folderId })
      const connection = connections.value.find(item => item.id === connId)
      if (connection) connection.folder_id = folderId
      if (folderId && !isExpanded(folderId)) expandedFolders.value.push(folderId)
    } catch (error) {
      showToast('Move failed: ' + errText(error))
    }
  }

  return {
    folders,
    expandedFolders,
    renamingFolderId,
    renameText,
    pendingDeleteId,
    resetDelete,
    ctxMenu,
    displayRows,
    moveMenuModel,
    loadFolders,
    isExpanded,
    toggleFolder,
    newFolder,
    startRenameFolder,
    commitRenameFolder,
    cancelRenameFolder,
    deleteFolder,
    openMoveMenu,
    onMovePick,
  }
}
