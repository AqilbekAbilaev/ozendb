// DBRef helpers for "Follow Reference" (Studio-3T parity). A MongoDB DBRef is the
// convention `{ $ref: <collection>, $id: <_id>, $db?: <database> }`; following one opens
// the referenced collection filtered to that document. Values here are canonical Extended
// JSON (relaxed:false), so an ObjectId id looks like `{ "$oid": "…" }`.

// Return { ref, id, db } if `value` is a DBRef, else null. `$db` is optional.
export function dbRefOf(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (typeof value.$ref !== 'string') return null
  if (!('$id' in value)) return null
  return {
    ref: value.$ref,
    id: value.$id,
    db: typeof value.$db === 'string' ? value.$db : null,
  }
}

// Build a shell-syntax `{ _id: … }` filter string for a DBRef's `$id`, in the dialect the
// query parser accepts. ObjectId ids become `ObjectId("…")`; strings and numbers become
// literals; anything else falls back to its JSON form (best effort for exotic id types).
export function idFilterString(id) {
  if (id !== null && typeof id === 'object' && !Array.isArray(id) && typeof id.$oid === 'string') {
    return `{ "_id": ObjectId("${id.$oid}") }`
  }
  if (typeof id === 'string') {
    return `{ "_id": ${JSON.stringify(id)} }`
  }
  if (typeof id === 'number' || typeof id === 'boolean') {
    return `{ "_id": ${id} }`
  }
  return `{ "_id": ${JSON.stringify(id)} }`
}
