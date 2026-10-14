import { setConnectionTag, setNodeTag, clearNodeTagsUnder } from '../appApi/tags'
import { tagOverrides } from '../stores/nodeTags'
import { nodeTagKey } from '../utils/tabColor'

// Writes a colour tag and mirrors it into the store's tagOverrides once persisted.
export function useNodeTags() {
  let tagWrite = Promise.resolve()

  // Apply a colour to a node. `type` is 'connection' | 'database' | 'collection'; `nodeData`
  // is the sidebar's right-click node, which carries the row's `resource`. Colouring a
  // parent resets its descendants (drop their own tags so they inherit the parent's new
  // colour).
  function applyColorTag(request) {
    const write = tagWrite.then(() => persistColorTag(request))
    tagWrite = write.catch(() => {})
    return write
  }

  async function persistColorTag({ type, nodeData, color }) {
    const resource = nodeData.resource
    let clearPrefix = null
    let key
    if (type === 'connection') {
      key = resource.connectionId
      await setConnectionTag(resource.connectionId, color)
      clearPrefix = key + '/'
    } else {
      // Database/collection tags go in the dedicated node-tag store, keyed by the node's tree
      // path so a colour tags only that node, not the whole connection.
      key = nodeTagKey(resource)
      await setNodeTag(key, color)
      if (type === 'database') clearPrefix = key + '/'
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
