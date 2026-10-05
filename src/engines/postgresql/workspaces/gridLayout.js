// The table tab grid's rows in display order (#170): each loaded row, followed by the
// staged inserts that name it as `after` (its primary-key string), in staged order. An
// insert with no anchor, or whose anchor isn't on this page, goes at the end. Entries are
// `{ row: loadedIndex }` or `{ draft: key }`.
export function gridLayout(rowKeys, inserts) {
  const following = new Map()
  const atEnd = []
  const onPage = new Set(rowKeys)
  for (const draft of inserts) {
    if (draft.after != null && onPage.has(draft.after)) {
      if (!following.has(draft.after)) following.set(draft.after, [])
      following.get(draft.after).push(draft)
    } else {
      atEnd.push(draft)
    }
  }
  const layout = []
  rowKeys.forEach((key, row) => {
    layout.push({ row })
    for (const draft of following.get(key) ?? []) layout.push({ draft: draft.key })
    // Shown once, after the first row with that key.
    following.delete(key)
  })
  for (const draft of atEnd) layout.push({ draft: draft.key })
  return layout
}
