// Global toolbar buttons, left→right. `sep: true` renders a divider instead of a button;
// `badge` is a small dot colour on the icon; `drop` shows a caret. `name` is the action
// id handed to App.vue's handleTool dispatcher, and the BaseIcon name unless `icon` says
// otherwise. `engine` limits a button to that engine being in focus (see toolbarTools).
export const TOOLS = [
  { name: 'connect',   label: 'Connect',      drop: true },
  { name: 'collection',label: 'Collection',   engine: 'mongodb' },
  { name: 'shell',     label: 'IntelliShell', engine: 'mongodb' },
  { name: 'sql',       label: 'SQL',          engine: 'mongodb' },
  { name: 'aggregate', label: 'Aggregate',    engine: 'mongodb' },
  { name: 'search',    label: 'Search in…',   engine: 'mongodb' },
  { sep: true },
  { name: 'schema',    label: 'Schema',       engine: 'mongodb' },
  { sep: true },
  { name: 'export',    label: 'Export',       engine: 'mongodb' },
  { name: 'import',    label: 'Import',       engine: 'mongodb' },
]
