// Colour-tag palette + resolution shared across the app — the tab bar, the workspace
// frame, the sidebar tree, the colour picker, and the connection dialog — so a tag's
// colour can never drift between where it's chosen and where it's shown. Each preset
// points at an existing theme token (never a raw hex), so the tags stay theme-aware
// and in step with the rest of the UI — blue is literally the app accent.
import { resourceAt } from './resourceRef'

const TAG_COLORS = {
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
function isHexColor(value) {
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
// `isCollection` is whether the tab is a collection tab, which the registry knows.
export function tabColorName(tab, tagOverrides, isCollection = false) {
  if (!tab) return null
  if (tab.color) return tab.color
  // The levels whose colour the tab can take, deepest first, read off its ref.
  let levels = []
  let keyOf = nodeTagKey
  if (isCollection) levels = ['collection', 'database', 'connection']
  else if (tab.type === 'mongodb.shell') levels = ['database', 'connection']
  else if (tab.type.startsWith('postgresql.')) {
    levels = ['table', 'schema', 'database', 'connection']
    keyOf = pgTagKey
  }
  const keys = levels.map((level) => resourceAt(tab.target, level)).filter(Boolean).map(keyOf)
  for (const key of keys) {
    const name = tagOverrides ? tagOverrides[key] : null
    if (name && name !== 'none') return name
  }
  return null
}

// A PostgreSQL row's key in the tag store: the connection id, then each name below it
// percent-encoded and joined by `/` (`p1/pay/a%2Fb/users`), so a `/` inside a name can't
// make two rows share a key, and a parent's key plus `/` is a prefix of exactly its
// descendants'. This is the persisted format, so it never changes.
export function pgTagKey(resource) {
  return [resource.connectionId, ...resource.segments.map((s) => encodeURIComponent(s.name))].join('/')
}

// The colour a PostgreSQL sidebar row shows: its own, else its nearest coloured parent's,
// ending with the connection's (`connTag`, its stored tag, until an override replaces it).
export function pgRowColorName(tagOverrides, resource, connTag = null) {
  for (let depth = resource.segments.length; depth > 0; depth--) {
    const name = nodeTagName(tagOverrides, pgTagKey({ ...resource, segments: resource.segments.slice(0, depth) }))
    if (name) return name
  }
  return nodeTagName(tagOverrides, resource.connectionId, connTag)
}

// A MongoDB tree node's key in the tag store: the connection id, then each name below
// it, joined by `/` (`c1`, `c1/shop`, `c1/shop/orders`). This is the persisted format,
// so it never changes; names are never split back out of it.
export function nodeTagKey(resource) {
  return [resource.connectionId, ...resource.segments.map((s) => s.name)].join('/')
}

// The colour a tree node sets itself: its override (keyed by the node's path) wins,
// otherwise its stored tag (connections only). Null when it has none or it's 'none';
// the tree then shows the nearest coloured ancestor's.
export function nodeTagName(tagOverrides, key, fallbackTag = null) {
  const override = tagOverrides[key]
  const name = override !== undefined ? override : fallbackTag
  return name && name !== 'none' ? name : null
}
