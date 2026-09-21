import { ref, computed } from 'vue'

// The one open right-click menu: { type, x, y, label?, nodeData }. Opened by whichever
// component was clicked, rendered once by App.vue, dispatched by useFeatures.
export const contextMenu = ref(null)

// The tree node the menu is open on, so the sidebar can keep it highlighted.
export const contextActiveNodeKey = computed(() => {
  const m = contextMenu.value
  if (!m) return null
  const nd = m.nodeData
  switch (m.type) {
    case 'connection': return nd.connId
    case 'database':   return nd.connId + '/' + nd.dbName
    case 'collection': return nd.connId + '/' + nd.dbName + '/' + nd.collName
    default:           return null
  }
})
