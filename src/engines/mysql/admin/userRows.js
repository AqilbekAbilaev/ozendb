// How the users panel reads the accounts the server reported. Pure, so the "may this be
// dropped" rules are pinned by a spec.

// The anonymous account's user is empty, which would otherwise read as a missing name.
export function accountName({ user, host }) {
  return `${user || "''"}@${host}`
}

export function userAttributes(user) {
  return [user.locked && 'Locked', user.passwordExpired && 'Password expired', user.plugin].filter(Boolean)
}

export function matchUsers(users, { search, showSystem }) {
  const term = (search ?? '').trim().toLowerCase()
  return users.filter(u => (showSystem || !u.system) && accountName(u).toLowerCase().includes(term))
}

// Refused before the server is asked for the two cases knowable here; anything else is
// the server's to refuse.
export function canDropUser(user) {
  if (user.system) return { ok: false, reason: 'MySQL reserves this account.' }
  if (user.current) return { ok: false, reason: 'You are connected as this account.' }
  return { ok: true }
}
