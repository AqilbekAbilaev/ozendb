import { ref } from 'vue'

// The open connections themselves, apart from openConnections.js's actions: that
// module imports connectionData.js, which needs each connection's engine from this list.
export const openConnections = ref([])
