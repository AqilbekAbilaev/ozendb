import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
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

// The live state behind the Current Operations tab: what the server is doing, refreshed
// on a timer the user picks. `connId` is a getter so the tab it serves can change.
export function useCurrentOps(connId) {
  const rows = ref([])
  const error = ref(null)
  const errorCode = ref(null)
  const loading = ref(false)
  const updatedAt = ref(null)

  const frequency = ref(2000)
  const retention = ref(10_000)

  // Filters. Own/sys are asked of the server as well (see the command), because $ownOps
  // is the only side that knows which user this connection authenticates as.
  const ownOnly = ref(false)
  const showSys = ref(false)
  const slowOnly = ref(false)
  const slowSecs = ref(3)
  const dbName = ref('')
  const collName = ref('')

  // One request at a time: a server slower than the poll rate would otherwise stack up
  // requests it can't answer.
  let inFlight = false

  async function load() {
    if (inFlight) return
    inFlight = true
    loading.value = rows.value.length === 0
    try {
      const reply = await invoke('current_ops', { id: connId(), ownOnly: ownOnly.value, all: showSys.value })
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
      await invoke('kill_op', { id: connId(), opid: opid })
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

  // Own/sys ops are server-side flags, so changing them needs a fresh reply rather than
  // a re-filter of what's already on screen.
  watch([ownOnly, showSys], () => { rows.value = []; load() })

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
    load: load,
    kill: kill,
  }
}
