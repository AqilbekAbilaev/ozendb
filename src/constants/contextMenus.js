// The right-click menus, keyed by the node type the click landed on. Data, not
// behaviour: every entry's `value` is the action id handed to the dispatcher (see
// composables/useFeatures), and its `label` is only what the menu shows — so renaming
// or translating a label never breaks the action. Ids match the native menu's where
// both offer the same action. contextMenus.test.js checks each one has a handler: a
// menu item nobody implemented is a bug, not a placeholder.
//
// Lives here rather than inside ContextMenu.vue so it can be imported and checked
// without mounting anything.

// The colour submenu's picks: this prefix plus the colour (a preset name or a hex).
export const COLOR_ACTION = 'node:color:'

const COPY_NAME = { value: 'node:copy_name', label: 'Copy Name', shortcut: '⌥⌘C' }
const CHOOSE_COLOR = { label: 'Choose Color', icon: 'brush', sub: 'color' }
const REFRESH = { value: 'node:refresh', label: 'Refresh', shortcut: '⌘R' }
const INTELLISHELL = { value: 'file:intellishell', label: 'Open IntelliShell', icon: 'shell' }
const SEARCH = { value: 'file:search', label: 'Search in…', icon: 'search' }
const IMPORT = { value: 'coll:import', label: 'Import…' }
const EXPORT = { value: 'coll:export', label: 'Export…' }

export const MENUS = {
  connection: [
    {
      label: 'Server Info', sub: 'list', subItems: [
        { value: 'file:server_build', label: 'Build Info' },
        { value: 'conn:host_info', label: 'Host Info' },
        { value: 'file:server_status', label: 'Server Status' },
        { value: 'conn:replica_status', label: 'Replica Set Status' },
      ],
    },
    { value: 'db:current_ops', label: 'Current Operations' },
    { sep: true },
    { ...INTELLISHELL, shortcut: '⌘L' },
    SEARCH,
    { sep: true },
    { value: 'db:add_database', label: 'Add Database…' },
    { sep: true },
    COPY_NAME,
    { value: 'conn:export_uri', label: 'Export URI…' },
    { sep: true },
    IMPORT,
    EXPORT,
    { sep: true },
    { value: 'node:refresh', label: 'Refresh Selected Item' },
    { value: 'view:refresh_all', label: 'Refresh All', shortcut: '⇧⌘R' },
    CHOOSE_COLOR,
    { sep: true },
    { value: 'conn:disconnect', label: 'Disconnect', shortcut: '⌃⌥D' },
    { value: 'conn:disconnect_others', label: 'Disconnect Others' },
    { value: 'conn:disconnect_all', label: 'Disconnect All' },
  ],
  database: [
    { ...INTELLISHELL, shortcut: '⌘L' },
    SEARCH,
    { value: 'gridfs:open', label: 'GridFS…', icon: 'folder' },
    { sep: true },
    { value: 'db:add_collection', label: 'Add Collection…' },
    { value: 'db:add_view', label: 'Add View…' },
    { sep: true },
    COPY_NAME,
    { value: 'db:duplicate', label: 'Duplicate Database…' },
    { sep: true },
    { value: 'db:profiler', label: 'Query Profiler' },
    { sep: true },
    IMPORT,
    EXPORT,
    { sep: true },
    REFRESH,
    CHOOSE_COLOR,
    { sep: true },
    { value: 'db:drop_database', label: 'Drop Database…', danger: true },
  ],
  collection: [
    { value: 'coll:open_tab', label: 'Open Collection', icon: 'collection', shortcut: '↵' },
    INTELLISHELL,
    { value: 'coll:aggregation', label: 'Open Aggregation Editor', icon: 'aggregate' },
    { sep: true },
    { value: 'coll:schema', label: 'View Schema', icon: 'schema' },
    { value: 'coll:history', label: 'Collection History', icon: 'history' },
    { value: 'coll:add_index', label: 'Indexes…' },
    { value: 'coll:stats', label: 'Collection Stats' },
    { sep: true },
    COPY_NAME,
    { value: 'coll:rename', label: 'Rename Collection…' },
    { value: 'coll:duplicate', label: 'Duplicate Collection…' },
    { sep: true },
    IMPORT,
    EXPORT,
    { sep: true },
    REFRESH,
    CHOOSE_COLOR,
    { sep: true },
    { value: 'coll:drop', label: 'Drop Collection…', danger: true },
  ],
  tab: [
    { value: 'tab:close', label: 'Close Tab' },
    { value: 'tab:close_others', label: 'Close Other Tabs' },
    { value: 'tab:close_left', label: 'Close Tabs to the Left' },
    { value: 'tab:close_right', label: 'Close Tabs to the Right' },
    { value: 'tab:close_all', label: 'Close All Tabs' },
    { sep: true },
    { value: 'tab:duplicate', label: 'Duplicate Tab', icon: 'copy' },
    { value: 'tab:move_front', label: 'Move Tab to the Front' },
    { value: 'tab:rename', label: 'Rename Tab…', icon: 'edit' },
    { sep: true },
    CHOOSE_COLOR,
  ],
}
