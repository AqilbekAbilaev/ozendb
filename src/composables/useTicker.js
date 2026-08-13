import { ref, watchEffect, onScopeDispose } from 'vue'

// A clock that only ticks while `active` is true, so an idle app isn't re-rendering
// on a timer it has nothing to show for. Read `now` to display live elapsed time.
export function useTicker(active, intervalMs = 100) {
  const now = ref(Date.now())
  let id = null

  function stop() {
    if (id == null) return
    clearInterval(id)
    id = null
  }

  watchEffect(() => {
    stop()
    if (!active.value) return
    now.value = Date.now()
    id = setInterval(() => { now.value = Date.now() }, intervalMs)
  })

  onScopeDispose(stop)

  return now
}
