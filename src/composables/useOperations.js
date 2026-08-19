import { ref, computed, onMounted, onUnmounted } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { listOperations, clearFinishedOperations } from '../appApi/operations'

// The Operations pane's data layer. It holds NO authoritative state of its own — the
// backend OperationsRegistry (operations.rs) is the single source of truth. This just
// fetches that list and re-fetches whenever the backend emits `operations-changed`
// (start/finish/cancel/clear), plus exposes the cancel/clear actions.
export function useOperations() {
  const operations = ref([])
  let unlisten = null

  async function refresh() {
    try {
      operations.value = await listOperations()
    } catch (e) {
      // A failed fetch just leaves the last-known list in place.
    }
  }

  async function clearFinished() {
    try {
      await clearFinishedOperations()
    } catch (e) {
      // Ignore — the next refresh will reflect the true state.
    }
  }

  // How many operations are still running — drives the rail toggle's badge.
  const runningCount = computed(
    () => operations.value.filter((op) => op.status === 'running').length,
  )

  onMounted(async () => {
    await refresh()
    unlisten = await listen('operations-changed', () => { refresh() })
  })

  onUnmounted(() => {
    if (unlisten) unlisten()
  })

  return {
    operations: operations,
    runningCount: runningCount,
    refresh: refresh,
    clearFinished: clearFinished,
  }
}
