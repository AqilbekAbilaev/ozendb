// The read-only lock (ResultsPanel's lock button, tab.readOnly) guards every
// frontend write entry point — toolbar buttons, native menu, keybindings — with
// the same refusal. It is accidental-edit protection, not a security boundary:
// the backend still refuses writes on read_only connections (client_for_write).
export function canWriteTab(tab) {
  return !(tab && tab.readOnly)
}

// The write actions the lock applies to. Mirrored by WRITE_ACTIONS in menu.rs
// (the Rust test pins both lists together). Read-only actions like doc:view_json
// and the edit:copy_* family deliberately stay out.
export const WRITE_ACTIONS = [
  'doc:edit_json',
  'doc:delete',
  'doc:add_field',
  'doc:edit_value',
  'doc:rename_field',
  'doc:remove_field',
  'coll:insert_document',
  'coll:update_dialog',
  'coll:delete_dialog',
  'coll:clear',
  'edit:paste_documents',
]

export function isWriteAction(id) {
  return WRITE_ACTIONS.includes(id)
}