import { setConnectionTag, setNodeTag, clearNodeTagsUnder } from '../appApi/tags'
import { setTagOverride, tagOverrides } from '../stores/nodeTags'
import { nodeTagKey, pgTagKey } from '../utils/tabColor'

// Writes a colour tag and mirrors it into the store's tagOverrides once persisted.
export function useNodeTags() {
  let tagWrite = Promise.resolve()

  // Apply a colour to a node. `type` is 'connection' | 'database' | 'collection', or for
  // PostgreSQL 'pg:database' | 'pg:schema' | 'pg:table'; `nodeData` is the sidebar's right-click
  // node, which carries the row's `resource`. Colouring a parent resets its descendants
  // (drop their own tags so they inherit the parent's new colour).
  function applyColorTag(request) {
    return queued(() => persistColorTag(request))
  }

  // A renamed node keeps its own colour: move it from the old key to the new one.
  function moveColorTag(fromKey, toKey) {
    return queued(async () => {
      const color = tagOverrides.value[fromKey]
      if (!color || color === 'none') return
      await setNodeTag(toKey, color)
      await setNodeTag(fromKey, 'none')
      setTagOverride(toKey, color)
      setTagOverride(fromKey, 'none')
    })
  }

  // A dropped node's colour, and its descendants', go with it, so nothing created later
  // under the same name picks them up.
  function forgetColorTags(key) {
    return queued(async () => {
      await setNodeTag(key, 'none')
      await clearNodeTagsUnder(key + '/')
      setTagOverride(key, 'none', key + '/')
    })
  }

  // Runs one write after the previous one settles, so rapid changes land in order.
  function queued(persist) {
    const write = tagWrite.then(persist)
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
    } else if (type.startsWith('pg:')) {
      key = pgTagKey(resource)
      await setNodeTag(key, color)
      if (type !== 'pg:table') clearPrefix = key + '/'
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
        setTagOverride(key, color)
        throw e
      }
    }

    setTagOverride(key, color, clearPrefix)
  }

  return { applyColorTag: applyColorTag, moveColorTag: moveColorTag, forgetColorTags: forgetColorTags }
}
