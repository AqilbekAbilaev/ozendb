import { ref } from 'vue'
import { listConnections } from '../engines/mongodb/api/connections'
import { getNodeTags, setConnectionTag, setNodeTag, clearNodeTagsUnder } from '../appApi/tags'

// Colour tags for tree nodes (connection / database / collection). `tagOverrides` maps a
// node key to a colour and drives the coloured dot shown in the sidebar and on tabs.
// Connection tags persist on the connection config (conn.tag, restored via
// list_connections); database/collection tags live in the dedicated node-tag store keyed
// by tree path.
export function useNodeTags() {
  const tagOverrides = ref({})
  let tagWrite = Promise.resolve()

  // Restore persisted colour tags so they survive a restart. Database/collection
  // tags come from the dedicated node-tag store; connection tags live on the
  // connection config (conn.tag) and are loaded from list_connections.
  async function loadNodeTags() {
    try {
      const nodeTags = await getNodeTags()
      if (nodeTags) tagOverrides.value = { ...nodeTags, ...tagOverrides.value }
    } catch (_) {}
    // Connection-level tags are stored on the connection config, not in the
    // node-tag store. Load them into tagOverrides so tabs (which resolve colour
    // from tagOverrides alone) can see connection-level colours at startup.
    try {
      const conns = await listConnections()
      const connTags = {}
      for (const c of conns) {
        if (c.tag) connTags[c.id] = c.tag
      }
      if (Object.keys(connTags).length) {
        tagOverrides.value = { ...tagOverrides.value, ...connTags }
      }
    } catch (_) {}
  }

  // Apply a colour to a node. `type` is 'connection' | 'database' | 'collection'; `nodeData`
  // is the sidebar shape ({ connId, connName, dbName, collName }). Colouring a parent resets
  // its descendants (drop their own tags so they inherit the parent's new colour).
  function applyColorTag(request) {
    const write = tagWrite.then(() => persistColorTag(request))
    tagWrite = write.catch(() => {})
    return write
  }

  async function persistColorTag({ type, nodeData, color }) {
    const nd = nodeData
    let clearPrefix = null
    let key
    if (type === 'connection') {
      key = nd.connId
      await setConnectionTag(nd.connId, color)
      clearPrefix = nd.connId + '/'
    } else {
      // Database/collection tags go in the dedicated node-tag store, keyed by the node's tree
      // path so a colour tags only that node, not the whole connection.
      key = type === 'database'
        ? nd.connId + '/' + nd.dbName
        : nd.connId + '/' + nd.dbName + '/' + nd.collName
      await setNodeTag(key, color)
      if (type === 'database') clearPrefix = nd.connId + '/' + nd.dbName + '/'
    }
    if (clearPrefix) {
      try {
        await clearNodeTagsUnder(clearPrefix)
      } catch (e) {
        tagOverrides.value = { ...tagOverrides.value, [key]: color }
        throw e
      }
    }

    const updated = { ...tagOverrides.value, [key]: color }
    if (clearPrefix) {
      for (const existing of Object.keys(updated)) {
        if (existing.startsWith(clearPrefix)) delete updated[existing]
      }
    }
    tagOverrides.value = updated
  }

  return {
    tagOverrides: tagOverrides,
    loadNodeTags: loadNodeTags,
    applyColorTag: applyColorTag,
  }
}
