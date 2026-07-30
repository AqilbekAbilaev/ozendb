// Build the backend `options` payload for Add Collection from the dialog's raw string
// inputs. Lives here rather than in the dialog so the per-type field rules stay unit
// tested — the dialog only binds inputs and shows the error.
//
// Follows the parsePipeline convention: { ok, options, error }. A standard collection
// yields `options: undefined` so the create request stays exactly as it was before the
// type picker existed.
export function buildCollectionOptions(type, opts) {
  if (type === 'capped') {
    const size = Number(opts.size)
    if (!Number.isFinite(size) || size <= 0) {
      return { ok: false, options: null, error: 'Enter a maximum size in bytes for the capped collection.' }
    }
    // Max document count is optional: anything non-positive means "no limit" (null).
    const max = Number(opts.max)
    return {
      ok: true,
      error: null,
      options: {
        capped: true,
        size: size,
        max: Number.isFinite(max) && max > 0 ? max : null,
      },
    }
  }

  if (type === 'timeseries') {
    const timeField = opts.timeField.trim()
    if (!timeField) {
      return { ok: false, options: null, error: 'Enter the time field for the time-series collection.' }
    }
    const expire = Number(opts.expireAfterSeconds)
    return {
      ok: true,
      error: null,
      options: {
        timeField: timeField,
        metaField: opts.metaField.trim() || null,
        granularity: opts.granularity.trim() || null,
        expireAfterSeconds: Number.isFinite(expire) && expire > 0 ? expire : null,
      },
    }
  }

  if (type === 'clustered') {
    return {
      ok: true,
      error: null,
      options: {
        clustered: true,
        clusteredIndexName: opts.clusteredIndexName.trim() || null,
      },
    }
  }

  return { ok: true, options: undefined, error: null }
}

// The empty option set the dialog starts from (and resets to).
export function emptyCollectionOptions() {
  return {
    size: '', max: '',
    timeField: '', metaField: '', granularity: '', expireAfterSeconds: '',
    clusteredIndexName: '',
  }
}
