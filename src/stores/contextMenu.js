import { ref, computed } from 'vue'

// The one open right-click menu: { type, x, y, label?, nodeData }. Opened by whichever
// component was clicked, rendered once by App.vue, dispatched by useFeatures.
export const contextMenu = ref(null)

// The tree node the menu is open on, so the sidebar can keep it highlighted.
export const contextActiveNodeKey = computed(() => {
  if (!contextMenu.value) return null
  const nd = contextMenu.value.nodeData
  if (contextMenu.value.type === 'connection') return nd.connId
  if (contextMenu.value.type === 'database') return nd.connId + '/' + nd.dbName
  return nd.connId + '/' + nd.dbName + '/' + nd.collName
})
