import { ref } from 'vue'
import { listConnections } from '../engines/mongodb/api/connections'
import { getNodeTags } from '../appApi/tags'

// Colour tags by tree node key; drives the coloured dot in the sidebar and on tabs.
// Connection tags persist on the connection config (conn.tag) and database/collection
// tags in the node-tag store, so the two are read from different places and merged.
export const tagOverrides = ref({})

export async function loadNodeTags() {
  try {
    const nodeTags = await getNodeTags()
    if (nodeTags) tagOverrides.value = { ...nodeTags, ...tagOverrides.value }
  } catch (_) {}
  try {
    const connTags = {}
    for (const c of await listConnections()) {
      if (c.tag) connTags[c.id] = c.tag
    }
    if (Object.keys(connTags).length) {
      tagOverrides.value = { ...tagOverrides.value, ...connTags }
    }
  } catch (_) {}
}
