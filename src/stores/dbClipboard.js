import { ref } from 'vue'

// The database or collection last copied from the sidebar, for Paste onto another node:
// { kind: 'collection'|'database', connId, connName, dbName, collName? } | null
export const dbClipboard = ref(null)
