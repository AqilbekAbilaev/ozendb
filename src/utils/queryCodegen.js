// Multi-language Query Code generator. Turns the raw shell-syntax query fields off a
// tab (filter / projection / sort / pipeline, …) into an idiomatic, copy-pasteable
// snippet for one of eight drivers.
//
// How it works:
//  - `shell` renders straight from the raw strings (identical to the old queryCode), so
//    there is zero regression to the shell output.
//  - Every other language parses each field through queryParser (parseField /
//    parsePipeline), producing canonical Extended JSON, then walks the JSON.parse tree
//    with a per-language value renderer (renderValue). JSON.parse preserves string-key
//    insertion order, so field order is preserved everywhere.
//
// v1 limitations (honest, documented):
//  - Exotic BSON types beyond ObjectId / Date / Long / Double / Decimal128 / regex
//    (e.g. Binary, Timestamp, Symbol, Code) are emitted as their raw Extended JSON in a
//    string literal, tagged `/* unmapped BSON type */` where the language has inline
//    block comments. Map the trivial-but-common ones as they come up.
//  - Go's ObjectIDFromHex / time.Parse / ParseDecimal128 also return an error that must
//    be handled in real code; the snippet drops it for brevity (a note is added).
//  - Python fromisoformat and PHP/Ruby double-quoted strings assume well-behaved values;
//    they are not hardened against every edge case.

import { parseField, parsePipeline } from './queryParser'
import { collectTypes, SCAFFOLDS } from './queryCodegen/scaffolds'

export const LANGUAGES = [
  { id: 'shell',  label: 'Shell' },
  { id: 'node',   label: 'Node.js' },
  { id: 'python', label: 'Python' },
  { id: 'java',   label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'php',    label: 'PHP' },
  { id: 'ruby',   label: 'Ruby' },
  { id: 'go',     label: 'Go' },
]

// Single-key wrappers that mark a BSON type in canonical Extended JSON. Query operators
// like $gt / $match also start with $ but are NOT in this set, so they render as plain
// map keys.
const SPECIAL = new Set([
  '$oid', '$date', '$numberInt', '$numberLong', '$numberDouble', '$numberDecimal',
  '$regularExpression', '$binary', '$timestamp', '$symbol', '$code', '$undefined',
  '$minKey', '$maxKey', '$dbPointer',
])

// Double-quoted, escaped string literal (valid across all eight languages).
const q = (s) => JSON.stringify(s)

function millisFromDate(val) {
  if (typeof val === 'string') return Date.parse(val)
  if (val && typeof val === 'object' && val.$numberLong != null) return Number(val.$numberLong)
  return Number(val)
}

function isEmptyDoc(tree) {
  return tree && typeof tree === 'object' && !Array.isArray(tree) && Object.keys(tree).length === 0
}

// Extract a plain integer from a sort direction value ($numberInt/$numberLong wrapper or
// bare number); returns null when the value is not a simple number (e.g. { $meta: … }).
function sortInt(val) {
  if (typeof val === 'number') return val
  if (val && typeof val === 'object') {
    if (val.$numberInt != null) return Number(val.$numberInt)
    if (val.$numberLong != null) return Number(val.$numberLong)
    if (val.$numberDouble != null) return Number(val.$numberDouble)
  }
  return null
}

// ── per-language value renderers ───────────────────────────────────────────────
// Each renderer maps an EJSON tree node to an idiomatic literal. `block` marks
// languages with inline block-comment syntax (used for the unmapped-type tag).

function unmapped(whole, R) {
  const raw = R.str(JSON.stringify(whole))
  return R.block ? `${raw} /* unmapped BSON type */` : raw
}

const RENDERERS = {
  node: {
    comment: '//', block: true,
    nul: 'null',
    bool: (b) => (b ? 'true' : 'false'),
    str: q,
    obj: (e) => (e.length ? `{ ${e.map(([k, v]) => `${q(k)}: ${v}`).join(', ')} }` : '{}'),
    arr: (it) => (it.length ? `[${it.join(', ')}]` : '[]'),
    objectId: (h) => `new ObjectId(${q(h)})`,
    date: (ms, iso) => `new Date(${q(iso)})`,
    int: (s) => s, long: (s) => s, double: (s) => s,
    decimal: (s) => `new Decimal128(${q(s)})`,
    regex: (p, o) => `new RegExp(${q(p)}${o ? `, ${q(o)}` : ''})`,
  },
  python: {
    comment: '#', block: false,
    nul: 'None',
    bool: (b) => (b ? 'True' : 'False'),
    str: q,
    obj: (e) => (e.length ? `{${e.map(([k, v]) => `${q(k)}: ${v}`).join(', ')}}` : '{}'),
    arr: (it) => (it.length ? `[${it.join(', ')}]` : '[]'),
    objectId: (h) => `ObjectId(${q(h)})`,
    date: (ms, iso) => `datetime.fromisoformat(${q(iso)})`,
    int: (s) => s, long: (s) => s, double: (s) => s,
    decimal: (s) => `Decimal128(${q(s)})`,
    regex: (p, o) => `Regex(${q(p)}${o ? `, ${q(o)}` : ''})`,
  },
  java: {
    comment: '//', block: true,
    nul: 'null',
    bool: (b) => (b ? 'true' : 'false'),
    str: q,
    obj: (e) => {
      if (!e.length) return 'new Document()'
      const [first, ...rest] = e
      return `new Document(${q(first[0])}, ${first[1]})` +
        rest.map(([k, v]) => `.append(${q(k)}, ${v})`).join('')
    },
    arr: (it) => `Arrays.asList(${it.join(', ')})`,
    objectId: (h) => `new ObjectId(${q(h)})`,
    date: (ms) => `new java.util.Date(${ms}L)`,
    int: (s) => s, long: (s) => `${s}L`, double: (s) => s,
    decimal: (s) => `Decimal128.parse(${q(s)})`,
    regex: (p, o) => `new BsonRegularExpression(${q(p)}, ${q(o)})`,
  },
  csharp: {
    comment: '//', block: true,
    nul: 'BsonNull.Value',
    bool: (b) => (b ? 'true' : 'false'),
    str: q,
    obj: (e) => (e.length ? `new BsonDocument { ${e.map(([k, v]) => `{ ${q(k)}, ${v} }`).join(', ')} }` : 'new BsonDocument()'),
    arr: (it) => (it.length ? `new BsonArray { ${it.join(', ')} }` : 'new BsonArray()'),
    objectId: (h) => `new ObjectId(${q(h)})`,
    date: (ms, iso) => `DateTime.Parse(${q(iso)})`,
    int: (s) => s, long: (s) => `${s}L`, double: (s) => s,
    decimal: (s) => `Decimal128.Parse(${q(s)})`,
    regex: (p, o) => `new BsonRegularExpression(${q(p)}, ${q(o)})`,
  },
  php: {
    comment: '//', block: true,
    nul: 'null',
    bool: (b) => (b ? 'true' : 'false'),
    str: q,
    obj: (e) => (e.length ? `[${e.map(([k, v]) => `${q(k)} => ${v}`).join(', ')}]` : '[]'),
    arr: (it) => (it.length ? `[${it.join(', ')}]` : '[]'),
    objectId: (h) => `new MongoDB\\BSON\\ObjectId(${q(h)})`,
    date: (ms, iso) => `new MongoDB\\BSON\\UTCDateTime(strtotime(${q(iso)}) * 1000)`,
    int: (s) => s, long: (s) => s, double: (s) => s,
    decimal: (s) => `new MongoDB\\BSON\\Decimal128(${q(s)})`,
    regex: (p, o) => `new MongoDB\\BSON\\Regex(${q(p)}, ${q(o)})`,
  },
  ruby: {
    comment: '#', block: false,
    nul: 'nil',
    bool: (b) => (b ? 'true' : 'false'),
    str: q,
    obj: (e) => (e.length ? `{ ${e.map(([k, v]) => `${q(k)} => ${v}`).join(', ')} }` : '{}'),
    arr: (it) => (it.length ? `[${it.join(', ')}]` : '[]'),
    objectId: (h) => `BSON::ObjectId.from_string(${q(h)})`,
    date: (ms, iso) => `DateTime.parse(${q(iso)})`,
    int: (s) => s, long: (s) => s, double: (s) => s,
    decimal: (s) => `BSON::Decimal128.new(${q(s)})`,
    regex: (p, o) => `BSON::Regexp::Raw.new(${q(p)}, ${q(o)})`,
  },
  go: {
    comment: '//', block: true,
    nul: 'nil',
    bool: (b) => (b ? 'true' : 'false'),
    str: q,
    obj: (e) => (e.length ? `bson.D{${e.map(([k, v]) => `{Key: ${q(k)}, Value: ${v}}`).join(', ')}}` : 'bson.D{}'),
    arr: (it) => `bson.A{${it.join(', ')}}`,
    objectId: (h) => `primitive.ObjectIDFromHex(${q(h)})`,
    date: (ms, iso) => `time.Parse(time.RFC3339, ${q(iso)})`,
    int: (s) => s, long: (s) => `int64(${s})`, double: (s) => s,
    decimal: (s) => `primitive.ParseDecimal128(${q(s)})`,
    regex: (p, o) => `primitive.Regex{Pattern: ${q(p)}, Options: ${q(o)}}`,
  },
}

function renderSpecial(key, val, whole, R) {
  switch (key) {
    case '$oid': return R.objectId(val)
    case '$numberInt': return R.int(val)
    case '$numberLong': return R.long(val)
    case '$numberDouble': return R.double(val)
    case '$numberDecimal': return R.decimal(val)
    case '$date': { const ms = millisFromDate(val); return R.date(ms, new Date(ms).toISOString()) }
    case '$regularExpression': return R.regex(val.pattern || '', val.options || '')
    default: return unmapped(whole, R)
  }
}

// Recursively render an EJSON tree node into a language literal.
function renderValue(v, R) {
  if (v === null) return R.nul
  if (typeof v === 'boolean') return R.bool(v)
  if (typeof v === 'string') return R.str(v)
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return R.arr(v.map((x) => renderValue(x, R)))
  // object
  const keys = Object.keys(v)
  if (keys.length === 1 && SPECIAL.has(keys[0])) return renderSpecial(keys[0], v[keys[0]], v, R)
  return R.obj(keys.map((k) => [k, renderValue(v[k], R)]))
}

// ── shell (raw-string passthrough, identical to the old queryCode computed) ─────
function shellCode(spec) {
  if (spec.mode === 'aggregate') {
    return `db.${spec.collection}.aggregate(${(spec.pipeline || '').trim() || '[]'})`
  }
  const filter = (spec.filter || '').trim() || '{}'
  const projection = (spec.projection || '').trim() || ''
  const sort = (spec.sort || '').trim() || ''
  const skip = spec.skip || 0
  const limit = spec.limit || 50
  let cmd = `db.${spec.collection}.find(${filter}`
  if (projection) cmd += `, ${projection}`
  cmd += ')'
  if (sort) cmd += `.sort(${sort})`
  if (skip) cmd += `.skip(${skip})`
  cmd += `.limit(${limit})`
  return cmd
}

// ── per-language find / aggregate assembly ──────────────────────────────────────
// Each entry: find(coll, parts, R) and aggregate(coll, stages, R), where `parts` is
// { filter, proj, sort, skip, limit } (proj/sort are null when empty) and `stages` is an
// array of already-rendered pipeline-stage strings.

const GENERATORS = {
  node: {
    find: (coll, { filter, proj, sort, skip, limit }, R) => {
      let s = `db.collection(${q(coll)}).find(${renderValue(filter, R)}`
      if (proj) s += `, { projection: ${renderValue(proj, R)} }`
      s += ')'
      if (sort) s += `.sort(${renderValue(sort, R)})`
      if (skip) s += `.skip(${skip})`
      if (limit) s += `.limit(${limit})`
      return s
    },
    aggregate: (coll, stages, R) => `db.collection(${q(coll)}).aggregate(${R.arr(stages)})`,
  },
  python: {
    find: (coll, { filter, proj, sort, skip, limit }, R) => {
      let args = renderValue(filter, R)
      if (proj) args += `, ${renderValue(proj, R)}`
      let s = `db.${coll}.find(${args})`
      if (sort) {
        const tuples = Object.keys(sort).map((k) => {
          const dir = sortInt(sort[k])
          return `(${q(k)}, ${dir != null ? dir : renderValue(sort[k], R)})`
        })
        s += `.sort([${tuples.join(', ')}])`
      }
      if (skip) s += `.skip(${skip})`
      if (limit) s += `.limit(${limit})`
      return s
    },
    aggregate: (coll, stages, R) => `db.${coll}.aggregate(${R.arr(stages)})`,
  },
  java: {
    find: (coll, { filter, proj, sort, skip, limit }, R) => {
      let s = `collection.find(${renderValue(filter, R)})`
      if (proj) s += `.projection(${renderValue(proj, R)})`
      if (sort) s += `.sort(${renderValue(sort, R)})`
      if (skip) s += `.skip(${skip})`
      if (limit) s += `.limit(${limit})`
      return s
    },
    aggregate: (coll, stages) =>
      `collection.aggregate(Arrays.asList(${stages.join(', ')}))`,
  },
  csharp: {
    find: (coll, { filter, proj, sort, skip, limit }, R) => {
      let s = `collection.Find(${renderValue(filter, R)})`
      if (proj) s += `.Project(${renderValue(proj, R)})`
      if (sort) s += `.Sort(${renderValue(sort, R)})`
      if (skip) s += `.Skip(${skip})`
      if (limit) s += `.Limit(${limit})`
      return s
    },
    aggregate: (coll, stages) =>
      `collection.Aggregate<BsonDocument>(new BsonDocument[] { ${stages.join(', ')} })`,
  },
  php: {
    find: (coll, { filter, proj, sort, skip, limit }, R) => {
      let s = `$collection->find(${renderValue(filter, R)}`
      const opts = []
      if (proj) opts.push(`"projection" => ${renderValue(proj, R)}`)
      if (sort) opts.push(`"sort" => ${renderValue(sort, R)}`)
      if (skip) opts.push(`"skip" => ${skip}`)
      if (limit) opts.push(`"limit" => ${limit}`)
      if (opts.length) s += `, [${opts.join(', ')}]`
      s += ')'
      return s
    },
    aggregate: (coll, stages, R) => `$collection->aggregate(${R.arr(stages)})`,
  },
  ruby: {
    find: (coll, { filter, proj, sort, skip, limit }, R) => {
      let s = `client[:${coll}].find(${renderValue(filter, R)})`
      if (proj) s += `.projection(${renderValue(proj, R)})`
      if (sort) s += `.sort(${renderValue(sort, R)})`
      if (skip) s += `.skip(${skip})`
      if (limit) s += `.limit(${limit})`
      return s
    },
    aggregate: (coll, stages, R) => `client[:${coll}].aggregate(${R.arr(stages)})`,
  },
  go: {
    find: (coll, { filter, proj, sort, skip, limit }, R) => {
      const opts = []
      if (proj) opts.push(`SetProjection(${renderValue(proj, R)})`)
      if (sort) opts.push(`SetSort(${renderValue(sort, R)})`)
      if (skip) opts.push(`SetSkip(${skip})`)
      if (limit) opts.push(`SetLimit(${limit})`)
      const optExpr = opts.length ? `, options.Find().${opts.join('.')}` : ''
      return `collection.Find(ctx, ${renderValue(filter, R)}${optExpr})`
    },
    aggregate: (coll, stages) =>
      `collection.Aggregate(ctx, mongo.Pipeline{${stages.join(', ')}})`,
  },
}

// Go's ObjectIDFromHex / time.Parse / ParseDecimal128 return an error the snippet drops.
function goErrorNote(code) {
  if (/ObjectIDFromHex|time\.Parse|ParseDecimal128/.test(code)) {
    return '// note: ObjectIDFromHex / time.Parse / ParseDecimal128 also return an error to handle\n' + code
  }
  return code
}

// ── per-language program scaffolds ──────────────────────────────────────────────
// Wrap a bare query expression (built by GENERATORS against the handle the scaffold
// declares) into a complete, runnable program: driver import → client with a
// PLACEHOLDER connection URI → database + collection handle → run the query → iterate
// the results → close the client. The URI is always a placeholder so no real
// credentials ever land in copy-pasteable code (the db/collection names are not
// secrets, so the real ones flow through).

export function generateCode(spec, language) {
  if (!spec || !spec.collection) return ''
  if (language === 'shell') return shellCode(spec)

  const R = RENDERERS[language]
  if (!R) return shellCode(spec)
  const gen = GENERATORS[language]
  const scaffold = SCAFFOLDS[language]
  const fail = `${R.comment} Fix the query before generating code`
  const db = spec.database || 'mydb'
  const coll = spec.collection
  const types = new Set()
  let query
  let mode

  if (spec.mode === 'aggregate') {
    mode = 'aggregate'
    const parsed = parsePipeline(spec.pipeline || '')
    if (!parsed.ok) return fail
    const pipeline = JSON.parse(parsed.ejson)
    collectTypes(pipeline, types)
    const stages = pipeline.map((stage) => renderValue(stage, R))
    query = gen.aggregate(coll, stages, R)
  } else {
    mode = 'find'
    const f = parseField(spec.filter || '')
    const proj = parseField(spec.projection || '')
    const sort = parseField(spec.sort || '')
    if (!f.ok || !proj.ok || !sort.ok) return fail

    const filterTree = JSON.parse(f.ejson)
    let projTree = JSON.parse(proj.ejson)
    let sortTree = JSON.parse(sort.ejson)
    collectTypes(filterTree, types)
    collectTypes(projTree, types)
    collectTypes(sortTree, types)
    if (isEmptyDoc(projTree)) projTree = null
    if (isEmptyDoc(sortTree)) sortTree = null
    const skip = Number(spec.skip) > 0 ? Number(spec.skip) : 0
    const limit = Number(spec.limit) > 0 ? Number(spec.limit) : 0

    query = gen.find(coll, {
      filter: filterTree,
      proj: projTree,
      sort: sortTree,
      skip: skip,
      limit: limit,
    }, R)
  }

  const program = scaffold({ db: db, coll: coll, query: query, mode: mode, types: types })
  return language === 'go' ? goErrorNote(program) : program
}
