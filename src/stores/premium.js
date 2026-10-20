import { ref, computed } from 'vue'
import { getEntitlement } from '../appApi/account'

// Whether this device may use Premium, as the backend last reported it. The backend
// owns the rules (grace period, clock drift); this only mirrors its answer.

const UNKNOWN = { state: 'unknown' }

export const entitlement = ref(UNKNOWN)
export const isPremium = computed(() => entitlement.value.state === 'premium')

let expiry = null

// A failed read rejects, so the error reaches the error log, and the last known answer
// stays. The backend judges Premium at the moment it is asked, so a Premium answer is
// asked again once it runs out.
export async function refreshPremium() {
  entitlement.value = await getEntitlement()
  clearTimeout(expiry)
  if (isPremium.value) expiry = setTimeout(refreshPremium, entitlement.value.until - Date.now())
}

// Module-scope state persists through HMR; tests use this to start each case clean.
export function resetPremium() {
  clearTimeout(expiry)
  entitlement.value = UNKNOWN
}
