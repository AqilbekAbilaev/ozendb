// Global toolbar buttons, left→right. `sep: true` renders a divider instead of a button;
// `badge` is a small dot colour on the icon; `drop` shows a caret. `name` is the action
// id handed to App.vue's handleTool dispatcher, and the BaseIcon name unless `icon` says
// otherwise. `engine` limits a button to that engine being in focus (see toolbarTools).
export const TOOLS = [
  { name: 'connect',   label: 'Connect',      drop: true },
  { name: 'collection',label: 'Collection',   engine: 'mongodb' },
  { name: 'pgTable',   label: 'Table',        engine: 'postgresql', icon: 'table' },
  { name: 'shell',     label: 'IntelliShell', engine: 'mongodb' },
  { name: 'sql',       label: 'SQL',          engine: 'mongodb' },
  { name: 'pgSql',     label: 'SQL',          engine: 'postgresql', icon: 'sql' },
  { name: 'aggregate', label: 'Aggregate',    engine: 'mongodb' },
  { name: 'search',    label: 'Search in…',   engine: 'mongodb' },
  { name: 'pgSearch',  label: 'Search in…',   engine: 'postgresql', icon: 'search' },
  { sep: true },
  { name: 'schema',    label: 'Schema',       engine: 'mongodb' },
  { sep: true },
  { name: 'export',    label: 'Export',       engine: 'mongodb' },
  { name: 'pgExport',  label: 'Export',       engine: 'postgresql', icon: 'export' },
  { name: 'import',    label: 'Import',       engine: 'mongodb' },
  { name: 'pgImport',  label: 'Import',       engine: 'postgresql', icon: 'import' },
]
