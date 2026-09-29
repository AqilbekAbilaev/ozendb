// How the routine browser labels, groups and filters what the server listed. Pure,
// so overloading (two routines with one name) is pinned by a spec.

// The call you would write, plus what comes back. A procedure returns nothing, so it
// promises nothing — an arrow to "void" would be a lie about what calling it gives.
export function signature(routine) {
  const call = `${routine.name}(${routine.arguments ?? ''})`
  return routine.returnType ? `${call} → ${routine.returnType}` : call
}

// Grouped for display, in the order the server listed them — it sorts by schema then
// name in its own collation, and re-sorting here would fight that for no gain.
export function groupBySchema(routines) {
  const groups = []
  for (const routine of routines) {
    const last = groups[groups.length - 1]
    if (last && last.schema === routine.schema) last.routines.push(routine)
    else groups.push({ schema: routine.schema, routines: [routine] })
  }
  return groups
}

// Findable by name, by schema, or by what it takes and returns — the argument list is
// searchable because "which of these takes a bigint" is the question a long list raises.
export function matchRoutines(routines, search) {
  const term = (search ?? '').trim().toLowerCase()
  if (!term) return routines
  return routines.filter(r =>
    r.name.toLowerCase().includes(term)
    || r.schema.toLowerCase().includes(term)
    || (r.arguments ?? '').toLowerCase().includes(term)
    || (r.returnType ?? '').toLowerCase().includes(term))
}
