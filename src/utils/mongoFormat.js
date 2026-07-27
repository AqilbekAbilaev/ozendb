// Shared formatting for MongoDB result values: a shell-style stringifier that
// renders EJSON wrappers (e.g. {"$oid": "..."}) the way mongosh does, plus a
// JSON syntax highlighter that wraps tokens in spans for theming. Used by both
// the results panel (JSON view / Explain) and the IntelliShell console.

/** Render a value as mongosh-style text — `{"$oid": "…"}` becomes `ObjectId("…")`. */
export function mongoStringify(value, indent = '') {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    const inner = indent + '  '
    const items = value.map((v) => inner + mongoStringify(v, inner))
    return '[\n' + items.join(',\n') + '\n' + indent + ']'
  }
  if (typeof value === 'object') {
    const wrapper = renderEjsonWrapper(value)
    if (wrapper !== null) return wrapper
    const keys = Object.keys(value)
    if (!keys.length) return '{}'
    const inner = indent + '  '
    const items = keys.map((k) => `${inner}${JSON.stringify(k)} : ${mongoStringify(value[k], inner)}`)
    return '{\n' + items.join(',\n') + '\n' + indent + '}'
  }
  return JSON.stringify(value)
}

// Recognizes MongoDB Extended JSON wrapper objects (the `{ "$oid": … }` shapes the
// driver emits for BSON types) and renders them the way the mongosh shell does.
// Returns null when `value` is a plain object so the caller renders it normally.
function renderEjsonWrapper(value) {
  const keys = Object.keys(value)
  if (keys.length === 1) {
    const key = keys[0]
    const inner = value[key]
    if (key === '$oid' && typeof inner === 'string') return `ObjectId("${inner}")`
    if (key === '$numberDecimal' && typeof inner === 'string') return `NumberDecimal("${inner}")`
    if (key === '$numberLong' && typeof inner === 'string') return `NumberLong("${inner}")`
    // Canonical EJSON boxes plain ints/doubles too; the shell shows them bare.
    if (key === '$numberInt' && typeof inner === 'string') return inner
    if (key === '$numberDouble' && typeof inner === 'string') return inner
    if (key === '$symbol' && typeof inner === 'string') return JSON.stringify(inner)
    if (key === '$date') {
      // Relaxed EJSON gives an ISO string; canonical gives { $numberLong: ms }.
      if (typeof inner === 'string') return `ISODate("${inner}")`
      if (inner && typeof inner === 'object' && typeof inner.$numberLong === 'string') {
        return `ISODate("${new Date(Number(inner.$numberLong)).toISOString()}")`
      }
    }
    if (key === '$timestamp' && inner && typeof inner === 'object') {
      return `Timestamp(${inner.t}, ${inner.i})`
    }
    if (key === '$binary' && inner && typeof inner === 'object' && typeof inner.base64 === 'string') {
      return `BinData(${parseInt(inner.subType, 16) || 0}, "${inner.base64}")`
    }
    if (key === '$regularExpression' && inner && typeof inner === 'object' && typeof inner.pattern === 'string') {
      return `/${inner.pattern}/${inner.options || ''}`
    }
    if (key === '$minKey') return 'MinKey()'
    if (key === '$maxKey') return 'MaxKey()'
  }
  // Legacy regex EJSON: { "$regex": "pattern", "$options": "i" } — $options optional.
  if (typeof value.$regex === 'string' && keys.every((k) => k === '$regex' || k === '$options')) {
    return `/${value.$regex}/${value.$options || ''}`
  }
  return null
}

/** Wrap JSON tokens in <span> elements (classes jk/jop/js/jn/jb/jl/joid) for theming. */
export function syntaxHighlight(json) {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /(\/(?:\\.|[^/\\\n])+\/[a-z]*|(?:ObjectId|ISODate|NumberDecimal|NumberLong|Timestamp|BinData|MinKey|MaxKey)\([^()]*\)|"(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        if (match[0] === '/' || /^[A-Za-z]+\(/.test(match)) return `<span class="joid">${match}</span>`
        if (match[0] === '"') {
          if (/:$/.test(match)) {
            return match[1] === '$'
              ? `<span class="jop">${match}</span>`
              : `<span class="jk">${match}</span>`
          }
          return `<span class="js">${match}</span>`
        }
        if (match === 'true' || match === 'false') return `<span class="jb">${match}</span>`
        if (match === 'null') return `<span class="jl">${match}</span>`
        return `<span class="jn">${match}</span>`
      }
    )
}

// MongoDB extended-JSON wrappers that render as a single scalar rather than a
// sub-document (`{"$oid": …}` is an ObjectId, not an object with one key). The tree
// views use this to decide what counts as a leaf.
export const EJSON_SCALAR = new Set([
  '$oid', '$date', '$numberLong', '$numberDecimal',
  '$numberInt', '$numberDouble', '$timestamp',
])

/** True when `value` is one of the EJSON wrappers above. */
export function isEjsonScalar(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === 1 && EJSON_SCALAR.has(keys[0])
}
