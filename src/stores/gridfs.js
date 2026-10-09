import { ref } from 'vue'

// GridFS-menu selection. The file row highlighted in the open GridFS dialog, which
// the GridFS file actions act on and whose presence gates them (see menuContext).
//
// It lives here rather than inside useGridfsBrowser because useMenu has to read it to
// derive the menu context, and a composable's state only lasts as long as the modal
// component. Mirrors how `selectedIndex` sits in stores/indexes.js while
// useIndexManager drives the dialog.
export const selectedGridfsFile = ref(null)  // the selected file doc | null

// Called when the dialog unmounts: a stale selection would leave the file actions
// enabled with no dialog to act in.
export function clearGridfsSelection() {
  selectedGridfsFile.value = null
}
