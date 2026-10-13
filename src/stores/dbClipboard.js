import { ref } from 'vue'

// The database or collection last copied from the sidebar, for Paste onto another node:
// { kind: 'collection'|'database', resource, connectionName } | null, where `resource`
// is that node's ResourceRef — a database ref for a copied database, a collection ref
// (database segment included) for a copied collection.
export const dbClipboard = ref(null)
