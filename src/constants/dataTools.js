// Option lists shared by the import and export screens.
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

// File formats we can write.
export const EXPORT_FORMATS = [
  { value: 'json', label: 'JSON' },
  { value: 'csv',  label: 'CSV' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
]

// How a JSON export renders ObjectId/Date/Decimal128 values. CSV and XLSX always write
// plain values already, so this choice only applies to the JSON format. Extended is the
// default: it's what mongoexport writes, and what keeps the file re-importable with its
// types intact — see issue #279.
export const JSON_VALUE_STYLES = [
  { value: 'extended', label: 'Extended JSON (keeps types, re-importable)' },
  { value: 'plain', label: 'Plain JSON' },
]

// How an import writes its documents. One option today; the dropdown exists so
// upsert/replace can be added without reworking the UI.
export const INSERT_MODES = [
  { value: 'insert', label: 'Insert documents' },
]

// Rows fetched for the preview grids in the import, CSV import and export screens.
export const PREVIEW_LIMIT = 20
