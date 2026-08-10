import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { errText } from '../utils/errors'
import { fmtClock } from '../utils/format'

// Hover intent for the sidebar's stats card, over a database row or a collection row —
// a target carrying a collName is a collection, one without is the database itself.
// Only the pointer coordinates are read off the event, so this stays DOM-free and testable.
// Stats are re-read on every hover: dbStats/collStats are metadata commands, and a cache
// would trade honest numbers for a saving nobody asked for.
// Beside the pointer, never below it: the card has to be reachable by moving sideways.
// Anything that puts it under the cursor makes the trip cross the next tree row, which
// takes the hover and swaps the card for that row's stats before you arrive.
const OFFSET_X = 14
const OFFSET_Y = -8

// How long the pointer must rest on a row before its card opens, and how long the card
// survives after the pointer leaves so it can be reached. Exported so the spec expresses
// "just before" and "just after" against the real values rather than copies of them.
export const HOVER_DELAY = 500
export const HOVER_GRACE = 200

export function useStatsTip({ delay = HOVER_DELAY, grace = HOVER_GRACE } = {}) {
  // null when nothing is hovered; otherwise { label, kind, x, y, stats, fetchedAt, error }
  // with stats still null while the command is in flight.
  const tip = ref(null)
  let timer = null
  let graceTimer = null
  let pending = null   // where the card will open, kept current until it does
  let current = null   // the open card's node, so Refresh knows what to re-read
  // Bumped by every show/hide so a reply that lands after the pointer has moved on is
  // discarded — without it, dragging down the tree paints each row's numbers over the
  // next one as the replies arrive out of order.
  let seq = 0

  // The pointer keeps moving during the delay, so the card anchors to wherever it ended
  // up rather than where it crossed into the row. Ignored once the card is open: an
  // anchor that chased the cursor would jitter under every pixel of movement.
  function move(e) {
    if (pending) pending = { x: e.clientX, y: e.clientY }
  }

  async function load(target, mine) {
    try {
      const stats = target.collName
        ? await invoke('collection_stats', {
          id: target.connId, database: target.dbName, collection: target.collName,
        })
        : await invoke('database_stats', { id: target.connId, database: target.dbName })
      if (mine === seq) tip.value = { ...tip.value, stats: stats, fetchedAt: fmtClock(), error: null }
    } catch (e) {
      if (mine === seq) tip.value = { ...tip.value, error: errText(e) }
    }
  }

  function show(e, target) {
    hide()
    const mine = seq
    pending = { x: e.clientX, y: e.clientY }
    timer = setTimeout(() => {
      current = target
      tip.value = {
        label: target.collName ? `${target.dbName}.${target.collName}` : target.dbName,
        kind: target.collName ? 'collection' : 'database',
        x: pending.x + OFFSET_X,
        y: pending.y + OFFSET_Y,
        stats: null, fetchedAt: null, error: null,
      }
      pending = null
      load(target, mine)
    }, delay)
  }

  // Re-read the open card's stats in place. The numbers are a snapshot of a live
  // collection, so the card says when it took them and offers to take them again.
  function refresh() {
    if (!tip.value || !current) return
    tip.value = { ...tip.value, stats: null, error: null }
    load(current, seq)
  }

  // Leaving the row closes the card, but not instantly: the pointer needs a moment to
  // cross the gap into it, since the numbers are there to be selected and copied.
  // Before the card is open there is nothing to cross to, so a passing cursor still
  // pays nothing.
  function hideSoon() {
    if (!tip.value) { hide(); return }
    clearTimeout(graceTimer)
    graceTimer = setTimeout(hide, grace)
  }

  // The pointer made it onto the card — call off the pending close.
  function keep() {
    clearTimeout(graceTimer)
    graceTimer = null
  }

  function hide() {
    clearTimeout(timer)
    clearTimeout(graceTimer)
    timer = null
    graceTimer = null
    pending = null
    current = null
    seq++
    tip.value = null
  }

  return {
    tip: tip, show: show, move: move, keep: keep,
    refresh: refresh, hideSoon: hideSoon, hide: hide,
  }
}
