// Mongo schema API: sampled schema analysis and schema export. Both commands are
// collection-scoped; the optional sample size is only sent when the caller provides it.

import { invoke } from '@tauri-apps/api/core'
import { collectionPayload } from './payload'

export function analyzeSchema(target, sampleSize) {
  const extra = {}
  if (sampleSize !== undefined) extra.sampleSize = sampleSize
  return invoke('analyze_schema', collectionPayload(target, extra))
}

export function exportSchema(target, sampleSize, path, format) {
  return invoke('export_schema', collectionPayload(target, { sampleSize, path, format }))
}