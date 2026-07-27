// Colour-tag palette + resolution shared across the app — the tab bar, the workspace
// frame, the sidebar tree, the colour picker, and the connection dialog — so a tag's
// colour can never drift between where it's chosen and where it's shown. Each preset
// points at an existing theme token (never a raw hex), so the tags stay theme-aware
// and in step with the rest of the UI — blue is literally the app accent.
export const TAG_COLORS = {
  blue:   'var(--accent)',
  green:  'var(--green)',
  purple: 'var(--purple)',
  red:    'var(--prod)',
  orange: 'var(--warn)',
}

// Ordered swatches for the colour pickers: "no colour" first, then each preset.
export const TAG_PRESETS = [
  { name: 'none',   color: 'transparent' },
  { name: 'blue',   color: TAG_COLORS.blue },
  { name: 'green',  color: TAG_COLORS.green },
  { name: 'purple', color: TAG_COLORS.purple },
  { name: 'red',    color: TAG_COLORS.red },
  { name: 'orange', color: TAG_COLORS.orange },
]

// True when a stored tag value is a raw hex colour (a custom colour) rather than one
// of the preset names above. Custom colours persist as their own '#rrggbb' string.
export function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

// Resolve a stored tag value to a CSS colour: a preset name maps to its colour; a raw
// hex (custom colour) is used as-is; anything else (unset / 'none') has no colour.
export function colorHex(value) {
  if (TAG_COLORS[value]) return TAG_COLORS[value]
  if (isHexColor(value)) return value
  return null
}

// The colour name in effect for a tab: a colour set on the tab itself wins;
// otherwise the tab takes its node's colour using the same own-colour-first
// cascade as the tree — check the collection, then the database, then the
// connection, and use the first that has a colour. Returns null when nothing set.
export function tabColorName(tab, tagOverrides) {
  if (!tab) return null
  if (tab.color) return tab.color
  const keys = []
  if (tab.kind === 'collection') {
    keys.push(`${tab.connectionId}/${tab.dbName}/${tab.collectionName}`)
    keys.push(`${tab.connectionId}/${tab.dbName}`)
    keys.push(tab.connectionId)
  } else if (tab.kind === 'shell') {
    keys.push(`${tab.connectionId}/${tab.dbName}`)
    keys.push(tab.connectionId)
  }
  for (const key of keys) {
    const name = tagOverrides ? tagOverrides[key] : null
    if (name && name !== 'none') return name
  }
  return null
}
