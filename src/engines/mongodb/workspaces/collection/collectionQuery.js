// A collection tab's find query as the backend wants it: parsed to canonical Extended JSON
// (utils/queryParser, MongoDB's own parser), validated, and packed into a run.
import { parseField } from '../../../../utils/queryParser'

export function parseFindQuery(query) {
  return {
    filter:     parseField(query.filter),
    projection: parseField(query.projection),
    sort:       parseField(query.sort),
  }
}

export function findQueryValid(parsed) {
  return parsed.filter.ok && parsed.projection.ok && parsed.sort.ok
}

// The first offending field's message, shown under the query area.
export function findQueryError(parsed) {
  if (!parsed.filter.ok) return 'Query: ' + parsed.filter.error
  if (!parsed.projection.ok) return 'Projection: ' + parsed.projection.error
  if (!parsed.sort.ok) return 'Sort: ' + parsed.sort.error
  return null
}

export function pipelineError(parsed) {
  if (!parsed || parsed.ok) return null
  return 'Pipeline: ' + parsed.error
}

// A bare 24-hex ObjectId typed as the whole filter means "this _id", so a copied id can be
// dropped straight into the box.
export function expandIdFilter(filter) {
  const v = (filter || '').trim()
  return /^[0-9a-fA-F]{24}$/.test(v) ? `{ _id: ObjectId("${v}") }` : filter
}

// The parsed fields plus paging, as find and its Explain both send them.
export function findArgs(query, parsed) {
  return {
    filter:     parsed.filter.ejson,
    projection: parsed.projection.ejson,
    sort:       parsed.sort.ejson,
    skip:       query.skip || 0,
    limit:      query.limit || 50,
  }
}
