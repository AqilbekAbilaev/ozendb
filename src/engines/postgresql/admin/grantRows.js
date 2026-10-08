// What the Grants modal shows and sends (#141). The privilege lists mirror
// kind_rules in src-tauri/src/commands/postgres/grants.rs, which refuses anything else.

export const GRANT_KINDS = ['schema', 'table', 'sequence']

const RELATION_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
const PRIVILEGES = {
  schema: ['USAGE', 'CREATE'],
  sequence: ['USAGE', 'SELECT', 'UPDATE'],
}
const RELATION_KINDS = ['table', 'view', 'matview', 'partitioned_table', 'foreign_table']

export function privilegesFor(kind) {
  if (RELATION_KINDS.includes(kind)) return RELATION_PRIVILEGES
  return PRIVILEGES[kind] ?? []
}

// One row per object with its privileges joined, grouped by schema; a null object is
// the schema itself.
export function groupGrants(grants) {
  const bySchema = new Map()
  for (const g of grants) {
    if (!bySchema.has(g.schema)) bySchema.set(g.schema, new Map())
    const objects = bySchema.get(g.schema)
    const key = g.object ?? ''
    if (!objects.has(key)) objects.set(key, { object: g.object, objectKind: g.objectKind, privileges: [] })
    objects.get(key).privileges.push(g.privilege)
  }
  return [...bySchema.entries()].map(([schema, objects]) => ({ schema, objects: [...objects.values()] }))
}

export function revokeChange(role, schema, obj, cascade) {
  return {
    role, objectKind: obj.objectKind, schema, object: obj.object,
    privileges: [...obj.privileges], cascade,
  }
}

// The grant form's draft as a change, or the first thing it still needs.
export function grantChange(role, draft) {
  const schema = draft.schema.trim()
  const object = draft.kind === 'schema' ? null : draft.object.trim()
  const allowed = privilegesFor(draft.kind)
  const privileges = allowed.filter(p => draft.privileges.includes(p))
  if (!schema) return { error: 'Enter a schema.' }
  if (object === '') return { error: `Enter the ${draft.kind} name.` }
  if (!privileges.length) return { error: 'Choose at least one privilege.' }
  return { change: { role, objectKind: draft.kind, schema, object, privileges, grantOption: !!draft.grantOption } }
}
