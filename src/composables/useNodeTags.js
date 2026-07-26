import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

// Colour tags for tree nodes (connection / database / collection). `tagOverrides` maps a
// node key to a colour and drives the coloured dot shown in the sidebar and on tabs.
// Connection tags persist on the connection config (conn.tag, restored via
// list_connections); database/collection tags live in the dedicated node-tag store keyed
// by tree path.
export function useNodeTags() {
  const tagOverrides = ref({})

  // Restore persisted database/collection colour tags so they survive a restart.
  // Connection tags come back on each connection (conn.tag) via list_connections.
  async function loadNodeTags() {
    try {
      const nodeTags = await invoke('get_node_tags')
      if (nodeTags) tagOverrides.value = { ...nodeTags, ...tagOverrides.value }
    } catch (_) {}
  }

  // Apply a colour to a node. `type` is 'connection' | 'database' | 'collection'; `nodeData`
  // is the sidebar shape ({ connId, connName, dbName, collName }). Colouring a parent resets
  // its descendants (drop their own tags so they inherit the parent's new colour).
  async function applyColorTag({ type, nodeData, color }) {
    const nd = nodeData
    let clearPrefix = null
    if (type === 'connection') {
      // Connection tags live on the connection config (conn.tag). The override gives instant
      // feedback; the command persists it for the next restart.
      tagOverrides.value = { ...tagOverrides.value, [nd.connId]: color }
      try { await invoke('set_connection_tag', { id: nd.connId, color: color }) } catch (_) {}
      clearPrefix = nd.connId + '/'
    } else {
      // Database/collection tags go in the dedicated node-tag store, keyed by the node's tree
      // path so a colour tags only that node, not the whole connection.
      const key = type === 'database'
        ? nd.connId + '/' + nd.dbName
        : nd.connId + '/' + nd.dbName + '/' + nd.collName
      tagOverrides.value = { ...tagOverrides.value, [key]: color }
      try { await invoke('set_node_tag', { key: key, color: color }) } catch (_) {}
      if (type === 'database') clearPrefix = nd.connId + '/' + nd.dbName + '/'
    }
    if (clearPrefix) {
      // Locally drop every descendant override so the tree/tabs re-inherit at once.
      const pruned = {}
      for (const k of Object.keys(tagOverrides.value)) {
        if (!k.startsWith(clearPrefix)) pruned[k] = tagOverrides.value[k]
      }
      tagOverrides.value = pruned
      try { await invoke('clear_node_tags_under', { prefix: clearPrefix }) } catch (_) {}
    }
  }

  return {
    tagOverrides: tagOverrides,
    loadNodeTags: loadNodeTags,
    applyColorTag: applyColorTag,
  }
}
