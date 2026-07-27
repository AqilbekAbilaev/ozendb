// Option lists shared by the import, export, masking and scheduled-task screens.
// These are the values the Rust side actually accepts, so a screen that hand-rolls
// its own copy can drift into offering something the backend rejects — or into
// labelling the same value differently from the screen next door.

// Per-column type coercion offered by the CSV import mapper and the export wizard.
// Values must match the `kind` strings the backend coercion understands.
export const BSON_KINDS = [
  { value: 'auto', label: 'Auto' },
  { value: 'string', label: 'String' },
  { value: 'int', label: 'Int32' },
  { value: 'long', label: 'Int64' },
  { value: 'double', label: 'Double' },
  { value: 'bool', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'objectId', label: 'ObjectId' },
]

// File formats we can write. Import can't target .xlsx, so it gets the shorter list.
export const EXPORT_FORMATS = [
  { value: 'json', label: 'JSON' },
  { value: 'csv',  label: 'CSV' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
]
export const IMPORT_FORMATS = EXPORT_FORMATS.filter((f) => f.value !== 'xlsx')

// How an import writes its documents. One option today; the dropdown exists so
// upsert/replace can be added without reworking the UI.
export const INSERT_MODES = [
  { value: 'insert', label: 'Insert documents' },
]

// Masking strategies. 'keep' is the "don't mask this field" default the masking
// pane needs; a task's rule list only ever holds fields that ARE masked, so it
// uses MASK_STRATEGIES instead.
export const MASK_STRATEGIES = [
  { value: 'redact',  label: 'Redact' },
  { value: 'hash',    label: 'Hash' },
  { value: 'partial', label: 'Partial' },
  { value: 'nullify', label: 'Null' },
  { value: 'remove',  label: 'Remove' },
]
export const FIELD_STRATEGIES = [{ value: 'keep', label: 'Keep' }, ...MASK_STRATEGIES]

// Rows fetched for the preview grids in the import, CSV import and export screens.
export const PREVIEW_LIMIT = 20
