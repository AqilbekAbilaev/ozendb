import { ref, computed } from 'vue'
import { getEntitlement } from '../appApi/account'

// Whether this device may use Premium, as the backend last reported it. The backend
// owns the rules (grace period, clock drift); this only mirrors its answer.

const UNKNOWN = { state: 'unknown' }

export const entitlement = ref(UNKNOWN)
export const isPremium = computed(() => entitlement.value.state === 'premium')

export async function refreshPremium() {
  try {
    entitlement.value = await getEntitlement()
  } catch (_) {
    // The last known answer is still the best one; a failed read is no reason to drop it.
  }
}

// Module-scope state persists through HMR; tests use this to start each case clean.
export function resetPremium() {
  entitlement.value = UNKNOWN
}
