import { ref } from 'vue'

// The one transient message the app shows at a time; AppToast.vue renders it.
export const TOAST_MS = 2200
export const toast = ref(null)
let timer = null

export function showToast(message) {
  clearTimeout(timer)
  toast.value = message
  timer = setTimeout(() => { toast.value = null }, TOAST_MS)
}
