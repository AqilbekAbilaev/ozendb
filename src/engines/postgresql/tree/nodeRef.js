import { createResourceRef } from '../../../utils/resourceRef'

// A sidebar node `{ connId, database, schema?, table? }` as the ResourceRef its tabs'
// targets are built from (postgresDefinitions), down to the deepest level it names —
// so a drop or rename finds exactly the tabs inside it.
export function pgNodeRef({ connId, database, schema, table }) {
  const segments = [{ kind: 'database', name: database }]
  if (schema != null) segments.push({ kind: 'schema', name: schema })
  if (schema != null && table != null) segments.push({ kind: 'table', name: table })
  return createResourceRef(connId, segments)
}
