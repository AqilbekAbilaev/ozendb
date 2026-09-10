// Pure helpers for the Document-menu field editors (Edit Value/Type, Add Field,
// Remove Field, Rename Field). They operate on the Extended-JSON-shaped plain
// objects the result grid holds (e.g. { _id: { $oid: "…" }, n: 3 }), producing a
// new root document that is sent to the `replace_document` backend command. Kept
// separate from the Vue component so the value/type + path logic is unit-tested
// (see docEdit.test.js).

// The BSON types the Edit/Add dialogs offer. 'JSON' is the escape hatch for
// objects, arrays, and anything the scalar types don't cover.
export const BSON_TYPES = [
  'String',
  'Int32',
  'Int64',
  'Double',
  'Boolean',
  'Null',
  'ObjectId',
  'Date',
  'JSON',
]

// Deep clone — results are JSON-serializable Extended JSON, so this is safe and
// keeps the original grid document untouched until the save succeeds.
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

// Walk `path` (an array of field names / array indices) from `root` and return the
// container object/array at that path, or undefined if the path doesn't resolve.
export function getContainer(root, path) {
  let cur = root
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}

// The current type/value of the field at `path[key]`, used to pre-fill the Edit
// Value/Type dialog. Returns { type, raw } where `raw` is the string form shown in
// the input.
export function inspectField(root, path, key) {
  const container = getContainer(root, path)
  const value = container && typeof container === 'object' ? container[key] : undefined
  return { type: detectType(value), raw: displayRaw(value) }
}

// Best-effort mapping of a stored (Extended-JSON) value back to one of BSON_TYPES.
export function detectType(value) {
  if (value === null || value === undefined) return 'Null'
  const t = typeof value
  if (t === 'string') return 'String'
  if (t === 'boolean') return 'Boolean'
  if (t === 'number') return Number.isInteger(value) ? 'Int32' : 'Double'
  if (t === 'object') {
    if ('$oid' in value) return 'ObjectId'
    if ('$date' in value) return 'Date'
    if ('$numberInt' in value) return 'Int32'
    if ('$numberLong' in value) return 'Int64'
    if ('$numberDouble' in value) return 'Double'
    // $numberDecimal, nested docs, and arrays are edited through the JSON escape hatch.
    return 'JSON'
  }
  return 'JSON'
}

// The string shown in the value input when a field of the given value is edited.
export function displayRaw(value) {
  const type = detectType(value)
  switch (type) {
    case 'Null':
      return ''
    case 'String':
      return value
    case 'Boolean':
      return String(value)
    case 'ObjectId':
      return value.$oid
    case 'Int32':
    case 'Int64':
    case 'Double':
      return typeof value === 'number'
        ? String(value)
        : String(value.$numberInt ?? value.$numberLong ?? value.$numberDouble)
    case 'Date': {
      const ms = dateMillis(value)
      return ms === null ? '' : new Date(ms).toISOString()
    }
    default:
      return JSON.stringify(value, null, 2)
  }
}

// Milliseconds since epoch from an Extended-JSON $date, or null if unrecognized.
function dateMillis(value) {
  const d = value.$date
  if (typeof d === 'string') {
    const parsed = Date.parse(d)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (d && typeof d === 'object' && '$numberLong' in d) return parseInt(d.$numberLong, 10)
  return null
}

// Build the stored (Extended-JSON) value for the chosen type from the raw input
// string. Throws with a human-readable message on invalid input so the dialog can
// surface it. The result is embedded in the document and decoded to BSON by the
// backend's `parse_ejson_document`.
export function buildTypedValue(type, raw) {
  const text = raw == null ? '' : String(raw)
  switch (type) {
    case 'String':
      return text
    case 'Int32': {
      if (!/^-?\d+$/.test(text.trim())) throw new Error('Enter a whole number for Int32')
      return { $numberInt: text.trim() }
    }
    case 'Int64': {
      if (!/^-?\d+$/.test(text.trim())) throw new Error('Enter a whole number for Int64')
      return { $numberLong: text.trim() }
    }
    case 'Double': {
      const n = Number(text.trim())
      if (text.trim() === '' || !Number.isFinite(n)) throw new Error('Enter a number for Double')
      return { $numberDouble: String(n) }
    }
    case 'Boolean': {
      const v = text.trim().toLowerCase()
      if (v === 'true') return true
      if (v === 'false') return false
      throw new Error('Enter true or false for Boolean')
    }
    case 'Null':
      return null
    case 'ObjectId': {
      const v = text.trim()
      if (!/^[0-9a-fA-F]{24}$/.test(v)) throw new Error('ObjectId must be 24 hex characters')
      return { $oid: v }
    }
    case 'Date': {
      const ms = Date.parse(text.trim())
      if (Number.isNaN(ms)) throw new Error('Enter a valid date (e.g. 2020-01-31T00:00:00Z)')
      return { $date: { $numberLong: String(ms) } }
    }
    case 'JSON': {
      try {
        return JSON.parse(text)
      } catch (e) {
        throw new Error('Invalid JSON: ' + e.message, { cause: e })
      }
    }
    default:
      throw new Error('Unknown type: ' + type)
  }
}

// Return a clone of `root` with `path[key]` set to `value`.
export function setFieldValue(root, path, key, value) {
  const copy = clone(root)
  const container = getContainer(copy, path)
  if (container === null || typeof container !== 'object') {
    throw new Error('Cannot locate the field to edit')
  }
  container[key] = value
  return copy
}

// Return a clone of `root` with a new `key: value` added to the container at `path`.
// Rejects a name that already exists so an add never silently overwrites.
export function addFieldValue(root, path, key, value) {
  const name = (key || '').trim()
  if (!name) throw new Error('Enter a field name')
  const copy = clone(root)
  const container = getContainer(copy, path)
  if (container === null || typeof container !== 'object' || Array.isArray(container)) {
    throw new Error('Cannot add a field here')
  }
  if (Object.prototype.hasOwnProperty.call(container, name)) {
    throw new Error(`Field "${name}" already exists`)
  }
  container[name] = value
  return copy
}

// Return a clone of `root` with `path[key]` removed. Splices arrays, deletes keys.
export function removeField(root, path, key) {
  const copy = clone(root)
  const container = getContainer(copy, path)
  if (container === null || typeof container !== 'object') {
    throw new Error('Cannot locate the field to remove')
  }
  if (Array.isArray(container)) {
    container.splice(Number(key), 1)
  } else {
    delete container[key]
  }
  return copy
}

// Return a clone of `root` with the key `oldKey` in the container at `path` renamed
// to `newKey`, preserving field order. Rejects renaming onto an existing key.
export function renameField(root, path, oldKey, newKey) {
  const name = (newKey || '').trim()
  if (!name) throw new Error('Enter a new field name')
  if (name === oldKey) return clone(root)
  const copy = clone(root)
  const container = getContainer(copy, path)
  if (container === null || typeof container !== 'object' || Array.isArray(container)) {
    throw new Error('Cannot rename this field')
  }
  if (!Object.prototype.hasOwnProperty.call(container, oldKey)) {
    throw new Error(`Field "${oldKey}" no longer exists`)
  }
  if (Object.prototype.hasOwnProperty.call(container, name)) {
    throw new Error(`Field "${name}" already exists`)
  }
  // Rebuild the object so the renamed key keeps its original position.
  const rebuilt = {}
  for (const [k, v] of Object.entries(container)) {
    rebuilt[k === oldKey ? name : k] = v
  }
  for (const k of Object.keys(container)) delete container[k]
  Object.assign(container, rebuilt)
  return copy
}
