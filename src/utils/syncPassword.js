// The sync password rules, mirrored from the backend (src-tauri/src/sync/setup.rs) so the
// form can say what is wrong while the user types. Lengths count characters as the
// backend does, after composing accents with their letters (NFC).

export const MIN_SYNC_PASSWORD = 12
export const MAX_SYNC_PASSWORD = 256

// What keeps `password` and its `confirmation` from being used, or '' when nothing does.
export function syncPasswordProblem(password, confirmation) {
  const length = [...password.normalize('NFC')].length
  if (length < MIN_SYNC_PASSWORD) return `Use at least ${MIN_SYNC_PASSWORD} characters.`
  if (length > MAX_SYNC_PASSWORD) return `Use at most ${MAX_SYNC_PASSWORD} characters.`
  if (password !== confirmation) return 'The two passwords do not match.'
  return ''
}
