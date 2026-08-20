// Canonical, engine-neutral resource identity (Work 2 contract). A ResourceRef is a
// connection plus an ordered list of { kind, name } segments from shallowest to
// deepest, so deeper hierarchies (e.g. PostgreSQL database/schema/table) fit without
// another redesign. Names are opaque — never parsed by `/` or `.` — and display names
// are presentation metadata, not identity. Connection scope is an empty segment list.

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0

export function createResourceRef(connectionId, segments = []) {
  if (!isNonEmptyString(connectionId)) {
    throw new TypeError('ResourceRef connectionId must be a non-empty string')
  }
  if (!Array.isArray(segments)) {
    throw new TypeError('ResourceRef segments must be an array')
  }
  for (const segment of segments) {
    if (
      !segment || typeof segment !== 'object'
      || !isNonEmptyString(segment.kind) || !isNonEmptyString(segment.name)
    ) {
      throw new TypeError('ResourceRef segments must be { kind, name } with non-empty strings')
    }
  }
  return { connectionId: connectionId, segments: segments.slice() }
}

export function appendResource(ref, kind, name) {
  if (!isResourceRef(ref)) {
    throw new TypeError('appendResource expects a ResourceRef')
  }
  if (!isNonEmptyString(kind) || !isNonEmptyString(name)) {
    throw new TypeError('appendResource kind and name must be non-empty strings')
  }
  return {
    connectionId: ref.connectionId,
    segments: [...ref.segments, { kind: kind, name: name }],
  }
}

export function isResourceRef(value) {
  if (!value || typeof value !== 'object') return false
  if (!isNonEmptyString(value.connectionId)) return false
  if (!Array.isArray(value.segments)) return false
  return value.segments.every(
    (s) => s && typeof s === 'object' && isNonEmptyString(s.kind) && isNonEmptyString(s.name),
  )
}

// Kind is the final segment's kind; connection scope reports 'connection' to match
// the tree's vocabulary even though it has no segment of its own.
export function resourceKind(ref) {
  if (!isResourceRef(ref)) return null
  return ref.segments.length === 0 ? 'connection' : ref.segments[ref.segments.length - 1].kind
}

export function resourceName(ref) {
  if (!isResourceRef(ref) || ref.segments.length === 0) return null
  return ref.segments[ref.segments.length - 1].name
}

export function sameResource(left, right) {
  if (!isResourceRef(left) || !isResourceRef(right)) return false
  if (left.connectionId !== right.connectionId) return false
  if (left.segments.length !== right.segments.length) return false
  return left.segments.every((s, i) => {
    const o = right.segments[i]
    return s.kind === o.kind && s.name === o.name
  })
}

// Strict ancestor: same connection and `ancestor`'s segments are a proper prefix of
// `descendant`'s — a connection-scope ref is the ancestor of every resource on that
// connection. Equal references are not ancestors of each other.
export function isResourceAncestor(ancestor, descendant) {
  if (!isResourceRef(ancestor) || !isResourceRef(descendant)) return false
  if (ancestor.connectionId !== descendant.connectionId) return false
  if (ancestor.segments.length >= descendant.segments.length) return false
  return ancestor.segments.every((s, i) => {
    const d = descendant.segments[i]
    return s.kind === d.kind && s.name === d.name
  })
}