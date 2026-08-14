// Catalog of MongoDB connection-string options surfaced in the Advanced tab.
//
// This is the single source of truth for the Advanced tab: the UI renders one
// labeled field per entry, grouped by category, and the field's input type
// follows `type`. Adding a future driver option is a one-line edit here.
//
// Scope: only options the linked `mongodb` Rust crate (3.2.2) actually accepts
// (verified empirically). Options already owned by other tabs — TLS (`tls*`),
// the replica-set name, auth (`authSource`/`authMechanism`), and the read
// preference mode (`readPreference`, on the Server tab) — are deliberately
// absent so the built URI never carries a key twice. Compression
// (`compressors`, `zlibCompressionLevel`) is omitted because the crate is built
// without the compression feature flags.
//
// Per-entry fields:
//   key          exact URI option name (correct casing)
//   label        human label shown in the form
//   type         'int' | 'string' | 'bool' | 'enum'
//   values       allowed values (enum only)
//   placeholder  hint text for int/string inputs (usually the driver default)
//   hint         one-line explanation shown under the field
//   needsReadPref  true → only valid when readPreference is set to a non-primary
//                  mode; the field is disabled and omitted from the URI otherwise
//   srvOnly      true → only valid for SRV connections; hidden otherwise

export const OPTION_GROUPS = [
  {
    title: 'Timeouts & Discovery',
    options: [
      { key: 'connectTimeoutMS', label: 'Connect timeout (ms)', type: 'int', placeholder: '10000' },
      { key: 'socketTimeoutMS', label: 'Socket timeout (ms)', type: 'int', placeholder: '0 (no timeout)' },
      { key: 'serverSelectionTimeoutMS', label: 'Server selection timeout (ms)', type: 'int', placeholder: '30000' },
      { key: 'heartbeatFrequencyMS', label: 'Heartbeat frequency (ms)', type: 'int', placeholder: '10000' },
      { key: 'localThresholdMS', label: 'Local threshold (ms)', type: 'int', placeholder: '15' },
      { key: 'maxIdleTimeMS', label: 'Max idle time (ms)', type: 'int', placeholder: '0 (no limit)' },
    ],
  },
  {
    title: 'Connection Pool',
    options: [
      { key: 'maxPoolSize', label: 'Max pool size', type: 'int', placeholder: '100' },
      { key: 'minPoolSize', label: 'Min pool size', type: 'int', placeholder: '0' },
      { key: 'maxConnecting', label: 'Max connecting', type: 'int', placeholder: '2' },
      { key: 'waitQueueTimeoutMS', label: 'Wait queue timeout (ms)', type: 'int', placeholder: '0' },
    ],
  },
  {
    title: 'Read / Write Concern',
    options: [
      {
        key: 'maxStalenessSeconds', label: 'Max staleness (s)', type: 'int', placeholder: '90+',
        needsReadPref: true,
        hint: 'Requires a non-primary read preference (set on the Server tab). Minimum 90.',
      },
      {
        key: 'readPreferenceTags', label: 'Read preference tags', type: 'string',
        placeholder: 'dc:ny,rack:1', needsReadPref: true,
        hint: 'Comma-separated key:value tags. Requires a non-primary read preference (set on the Server tab).',
      },
      {
        key: 'readConcernLevel', label: 'Read concern level', type: 'enum',
        values: ['local', 'majority', 'linearizable', 'available'],
      },
      { key: 'w', label: 'Write concern (w)', type: 'string', placeholder: 'majority or a number' },
      { key: 'wtimeoutMS', label: 'Write concern timeout (ms)', type: 'int', placeholder: '0' },
      { key: 'journal', label: 'Journal (j)', type: 'bool' },
      { key: 'retryReads', label: 'Retry reads', type: 'bool' },
      { key: 'retryWrites', label: 'Retry writes', type: 'bool' },
    ],
  },
  {
    title: 'Miscellaneous',
    options: [
      { key: 'appName', label: 'App name', type: 'string', placeholder: 'OzenDB' },
      { key: 'loadBalanced', label: 'Load balanced', type: 'bool' },
      {
        key: 'uuidRepresentation', label: 'UUID representation', type: 'enum',
        values: ['csharpLegacy', 'javaLegacy', 'pythonLegacy'],
        hint: 'Legacy BSON UUID encodings only.',
      },
      {
        key: 'srvMaxHosts', label: 'SRV max hosts', type: 'int', placeholder: '0 (all)',
        srvOnly: true,
        hint: 'Only applies to DNS Seedlist (SRV) connections.',
      },
    ],
  },
]

// Flat list of every catalog key — used to tell catalog-managed options apart
// from any unknown options a stored config may carry (which are preserved).
export const KNOWN_OPTION_KEYS = OPTION_GROUPS.flatMap(g => g.options.map(o => o.key))

// The editor's tabs, and the fixed choice lists its selects offer. Constants rather
// than form state, so they live with the option catalog instead of in the dialog.
export const TABS = [
  ['server', 'Server'],
  ['auth', 'Authentication'],
  ['ssh', 'SSH Tunnel'],
  ['ssl', 'SSL'],
  ['advanced', 'Advanced'],
]

// `available: false` modes are shown disabled and badged "soon" rather than hidden,
// so the list reads as the full set of what MongoDB supports.
export const AUTH_MODES = [
  { value: 'none',          label: 'None',                            available: true  },
  { value: 'SCRAM-SHA-256', label: 'Basic (SCRAM-SHA-256)',           available: true  },
  { value: 'SCRAM-SHA-1',   label: 'Legacy (SCRAM-SHA-1)',            available: true  },
  { value: 'PLAIN',         label: 'LDAP (PLAIN)',                    available: true  },
  { value: 'X509',          label: 'X.509',                           available: false },
  { value: 'GSSAPI',        label: 'Kerberos (GSSAPI)',               available: false },
  { value: 'AWS',           label: 'AWS Identity and Access Management (IAM)', available: false },
  { value: 'OIDC',          label: 'OIDC — workload identity',        available: true  },
]

export const AUTH_MODE_OPTIONS = AUTH_MODES.map((m) => ({
  value: m.value, label: m.label, disabled: !m.available, soon: !m.available,
}))

export const READ_PREF_OPTIONS = [
  { value: '',                   label: 'Primary (default)' },
  { value: 'primaryPreferred',   label: 'Primary preferred' },
  { value: 'secondary',          label: 'Secondary' },
  { value: 'secondaryPreferred', label: 'Secondary preferred' },
  { value: 'nearest',            label: 'Nearest' },
]

export const BOOL_OPTIONS = [
  { value: '',      label: '(default)' },
  { value: 'true',  label: 'true' },
  { value: 'false', label: 'false' },
]

// `test` is the driver's built-in test flow (reads a token file); azure/gcp need a
// TOKEN_RESOURCE (the audience).
export const OIDC_ENVIRONMENTS = [
  { value: 'azure', label: 'Azure' },
  { value: 'gcp',   label: 'GCP' },
  { value: 'test',  label: 'Test' },
]

// An Advanced enum field's choices: '(default)' plus the catalog's allowed values.
export function enumOptions(opt) {
  return [{ value: '', label: '(default)' }, ...opt.values.map((v) => ({ value: v, label: v }))]
}
