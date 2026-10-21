import { ref, computed } from 'vue'
import { getEntitlement } from '../appApi/account'

// Whether this device may use Premium, as the backend last reported it. The backend
// owns the rules (grace period, clock drift); this only mirrors its answer.

const UNKNOWN = { state: 'unknown' }

export const entitlement = ref(UNKNOWN)
export const isPremium = computed(() => entitlement.value.state === 'premium')

// The backend judges Premium at the moment it is asked, so a Premium answer is asked
// again once the clock passes its end. A check every minute rather than one timer set
// for the end, because timers pause while the computer sleeps and the end can be days away.
const CHECK_EVERY_MS = 60 * 1000

let watch = null

// A failed read rejects, so the error reaches the error log, and the last known answer stays.
export async function refreshPremium() {
  entitlement.value = await getEntitlement()
  clearInterval(watch)
  if (isPremium.value) watch = setInterval(askAgainOnceRunOut, CHECK_EVERY_MS)
}

function askAgainOnceRunOut() {
  if (Date.now() >= entitlement.value.until) refreshPremium()
}

// Module-scope state persists through HMR; tests use this to start each case clean.
export function resetPremium() {
  clearInterval(watch)
  entitlement.value = UNKNOWN
}
