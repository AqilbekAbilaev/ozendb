import { ref } from 'vue'

// The file selected in the open GridFS dialog, here so useMenu can gate on it
// (like `selectedIndex` in stores/indexes.js).
export const selectedGridfsFile = ref(null)  // the selected file doc | null

export function clearGridfsSelection() {
  selectedGridfsFile.value = null
}
