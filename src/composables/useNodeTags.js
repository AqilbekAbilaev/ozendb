import { setConnectionTag, setNodeTag, clearNodeTagsUnder } from '../appApi/tags'
import { tagOverrides } from '../stores/nodeTags'

// Writes a colour tag and mirrors it into the store's tagOverrides once persisted.
export function useNodeTags() {
  let tagWrite = Promise.resolve()

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

  return { applyColorTag: applyColorTag }
}
