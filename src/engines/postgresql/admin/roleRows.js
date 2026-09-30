// How the roles panel reads what the server reported. Pure, so the membership graph
// and the "may this be dropped" rules are pinned by a spec.

// Strongest first, so scanning a column of these surfaces the dangerous ones. A role
// with none of them still says something: an empty cell would read as missing data.
const ATTRIBUTES = [
  ['canLogin', 'Login'],
  ['superuser', 'Superuser'],
  ['createRole', 'Create role'],
  ['createDb', 'Create DB'],
  ['replication', 'Replication'],
  ['bypassRls', 'Bypass RLS'],
]

export function roleAttributes(role, { withLimit = false } = {}) {
  const held = ATTRIBUTES.filter(([field]) => role[field]).map(([, label]) => label)
  const out = held.length ? held : ['No login']
  // -1 is Postgres's "no limit"; only a real cap is worth saying.
  if (withLimit && role.connectionLimit >= 0) out.push(`Max ${role.connectionLimit} connections`)
  return out
}

// The backend reports membership in one direction — the roles a role belongs to.
// Reading the same edges backwards answers "who belongs to this group", without a
// second query.
export function membersOf(roles, name) {
  return roles.filter(r => (r.memberOf ?? []).includes(name)).map(r => r.name)
}

// Dropping is refused before the server is asked, for the two cases where the answer
// is knowable here. Everything else (a role that still owns objects) is the server's
// to refuse, with the detail only it has.
export function canDropRole(role, currentUser) {
  if (role.system) return { ok: false, reason: 'PostgreSQL manages this role.' }
  if (role.name === currentUser) return { ok: false, reason: 'You are connected as this role.' }
  return { ok: true }
}

export function matchRoles(roles, { search, showSystem = false, loginOnly = false } = {}) {
  const term = (search ?? '').trim().toLowerCase()
  return roles.filter((role) => {
    if (!showSystem && role.system) return false
    if (loginOnly && !role.canLogin) return false
    if (!term) return true
    // Searching a group's name finds the group and everyone in it, which is how you
    // ask "who has this access" without knowing the member names.
    return role.name.toLowerCase().includes(term)
      || (role.memberOf ?? []).some(m => m.toLowerCase().includes(term))
  })
}
