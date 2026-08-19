import { ref, computed, watch } from 'vue'
import { currentOps, killOp } from '../engines/mongodb/api/admin'
import { errText, errCode } from '../utils/errors'
import { normalizeOps, mergeRetained, filterOps } from '../utils/currentOps'
import { useTicker } from './useTicker'

// Poll rates offered in the toolbar. 0 is "Off" — the tab then only refreshes on demand.
export const FREQUENCIES = [
  { value: 0,    label: 'Off' },
  { value: 1000, label: '1 sec' },
  { value: 2000, label: '2 sec' },
  { value: 5000, label: '5 sec' },
]

// Thresholds offered for "Show only slow ops".
export const SLOW_THRESHOLDS = [
  { value: 1,  label: '1 sec' },
  { value: 3,  label: '3 sec' },
  { value: 5,  label: '5 sec' },
  { value: 10, label: '10 sec' },
]

// How long an operation stays on screen after the server stops reporting it.
export const RETENTIONS = [
  { value: 0,      label: 'Off' },
  { value: 5000,   label: '5 sec' },
  { value: 10_000, label: '10 sec' },
  { value: 30_000, label: '30 sec' },
]

// What a freshly opened Current Operations tab starts with. They live on the tab (see
// below), so the tab creator seeds them there. A factory, not a constant: the arrays and
// the column order are mutated per tab, and a shared instance would tie two tabs together.
export const opsDefaults = () => ({
  frequency: 2000,
  retention: 10_000,
  ownOnly: false,
  showSys: false,
  slowOnly: false,
  slowSecs: 3,
  dbName: '',
  collName: '',
  view: 'table',
  // The operations last seen, with their retention stamps. On the tab rather than in the
  // pane because watching an op means leaving this tab — you start a query elsewhere and
  // cancel it elsewhere — and a list that resets on every return retains nothing.
  ops: [],
  // The shared result grid reads its state off the tab, exactly as a collection tab does.
  results: [],
  // The grid's drill-down breadcrumb roots itself on this label.
  collectionName: 'Current Operations',
  hasRun: false,
  isRunning: false,
  selectedRow: -1,
  selectedRows: [],
  drillPath: [],
  colOrder: {},
})

// The live state behind the Current Operations tab: what the server is doing, refreshed
// on a timer the user picks. `tab` is a getter — one pane instance is reused across tabs
// of this kind, so every read has to go to whichever tab is active now.
export function useCurrentOps(tab) {
  // The toolbar settings are stored on the tab rather than in local refs: a tab switch
  // unmounts the pane, and settings that reset themselves on the way back are worse than
  // no settings at all.
  const setting = (key) => computed({
    get: () => tab()[key],
    set: (value) => { tab()[key] = value },
  })
  const rows = setting('ops')
  const error = ref(null)
  const errorCode = ref(null)
  const loading = ref(false)
  const updatedAt = ref(null)

  const frequency = setting('frequency')
  const retention = setting('retention')

  // Filters. Own/sys are asked of the server as well (see the command), because $ownOps
  // is the only side that knows which user this connection authenticates as.
  const ownOnly = setting('ownOnly')
  const showSys = setting('showSys')
  const slowOnly = setting('slowOnly')
  const slowSecs = setting('slowSecs')
  const dbName = setting('dbName')
  const collName = setting('collName')
  const view = setting('view')

  // One request at a time: a server slower than the poll rate would otherwise stack up
  // requests it can't answer.
  let inFlight = false

  async function load() {
    if (inFlight) return
    inFlight = true
    loading.value = rows.value.length === 0
    try {
      const reply = await currentOps(tab().connId, { ownOnly: ownOnly.value, all: showSys.value })
      rows.value = mergeRetained(rows.value, normalizeOps(reply), retention.value, Date.now())
      updatedAt.value = Date.now()
      error.value = null
      errorCode.value = null
    } catch (e) {
      // Keep showing the last good list — a blink of blank table on one failed poll
      // hides more than the error message tells.
      error.value = errText(e)
      errorCode.value = errCode(e)
    } finally {
      loading.value = false
      inFlight = false
    }
  }

  // Kill one operation, then refresh so the table reflects it straight away rather than
  // at the next poll (which may be seconds away, or off).
  async function kill(opid) {
    try {
      await killOp(tab().connId, opid)
      await load()
      return true
    } catch (e) {
      error.value = errText(e)
      errorCode.value = errCode(e)
      return false
    }
  }

  const visible = computed(() => filterOps(rows.value, {
    dbName: dbName.value, collName: collName.value,
    slowOnly: slowOnly.value, slowSecs: slowSecs.value, showSys: showSys.value,
  }))

  // What the grid's selected row is, as an opid — the identity that survives a refresh.
  const selectedOpid = computed(() => {
    const row = visible.value[tab().selectedRow]
    return row ? row.opid : null
  })

  // The grid renders the documents the server sent, untouched — the row objects above are
  // only how this composable filters and retains them.
  watch(visible, (list, previous) => {
    const tab_ = tab()
    // The selection is an index into a list a poll can reshuffle, so read which operation
    // it pointed at in the OLD list, then find that operation in the new one. Otherwise a
    // kill lands on whatever slid into that row.
    const wasOn = previous ? previous[tab_.selectedRow] : null
    tab_.results = list.map(row => row.raw)
    tab_.hasRun = true
    tab_.selectedRow = wasOn ? list.findIndex(row => row.opid === wasOn.opid) : -1
    tab_.selectedRows = tab_.selectedRow >= 0 ? [tab_.selectedRow] : []
  })

  // Own/sys ops are server-side flags, so changing them needs a fresh reply rather than
  // a re-filter of what's already on screen.
  watch([ownOnly, showSys], () => { rows.value = []; load() })

  const retainedCount = computed(() => visible.value.filter(row => row.expiredAt).length)
  const idleCount = computed(() => visible.value.filter(row => row.idle).length)

  const polling = computed(() => frequency.value > 0)
  const now = useTicker(polling, frequency)
  watch(now, load)

  // Retention shrinking (or being switched off) should take effect on the spot rather
  // than at the next poll, which may be seconds away or never.
  watch(retention, () => {
    rows.value = mergeRetained(rows.value, rows.value.filter(r => !r.expiredAt), retention.value, Date.now())
  })

  return {
    rows: rows,
    visible: visible,
    selectedOpid: selectedOpid,
    retainedCount: retainedCount,
    idleCount: idleCount,
    error: error,
    errorCode: errorCode,
    loading: loading,
    updatedAt: updatedAt,
    frequency: frequency,
    retention: retention,
    ownOnly: ownOnly,
    showSys: showSys,
    slowOnly: slowOnly,
    slowSecs: slowSecs,
    dbName: dbName,
    collName: collName,
    view: view,
    load: load,
    kill: kill,
  }
}
