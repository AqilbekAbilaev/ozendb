// UI zoom levels. A fixed ladder rather than a free multiplier so steps land on
// predictable, legible sizes (the same approach browsers take) and repeated zooming
// can't drift onto awkward fractions.
export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
export const DEFAULT_ZOOM = 1

// The nearest rung to `factor` — used when applying a persisted value, which may be
// from an older ladder or a hand-edited settings file.
export function nearestZoom(factor) {
  const value = Number(factor)
  // `> 0` rather than just finite: Number(null) and Number('') are 0, which would
  // otherwise snap to the smallest rung instead of falling back to the default.
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_ZOOM
  return ZOOM_LEVELS.reduce((best, level) =>
    Math.abs(level - value) < Math.abs(best - value) ? level : best)
}

// Step `delta` rungs from the current factor (+1 in, -1 out), stopping at the ends.
// Off-ladder inputs snap to the nearest rung first, so a stale value still steps sanely.
export function stepZoom(current, delta) {
  const index = ZOOM_LEVELS.indexOf(nearestZoom(current))
  const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + delta))
  return ZOOM_LEVELS[next]
}
