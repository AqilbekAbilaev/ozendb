import { ref } from 'vue'

// The file selected in the open GridFS dialog, here so MongoDB's menu (../menu.js) gates on it
// (like `selectedIndex` in admin/indexes.js).
export const selectedGridfsFile = ref(null)  // the selected file doc | null

export function clearGridfsSelection() {
  selectedGridfsFile.value = null
}
