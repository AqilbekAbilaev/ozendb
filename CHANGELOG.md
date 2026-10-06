# Changelog

## v0.2.1

- **PostgreSQL tables are fully editable now** — edit, insert and delete rows
  in the grid. Changes are staged and shown as the SQL that will run before
  you commit or roll them back together, every edit is kept in a per-tab
  history with undo, and a new or duplicated row is highlighted and scrolled
  into view. A connection or a single tab can also be locked read-only to
  block writes entirely.
- **Manage schema from the sidebar** — create and drop schemas, create a
  table from a column editor, and rename or drop existing tables and
  schemas.
- **Roles and privileges** — browse and manage roles, see a role's direct
  grants, and grant or revoke privileges on schemas, tables and sequences
  from the Grants modal.
- **Browse functions and procedures**, including their source, from the
  sidebar.
- **Server diagnostics** — a Server Info panel shows version, uptime,
  settings and installed extensions; a Server Activity panel watches live
  sessions and can cancel or terminate one; hovering a table shows its size,
  bloat and index usage, and the sidebar shows each database's size.
- **Search in Schema is now a tab**, like MongoDB's, so its filters and
  results stay put while you work elsewhere; opening a match jumps straight
  to that row in a table tab filtered to its primary key. Other databases on
  the same server are now listed in the sidebar too, and searching or
  opening one reuses the connection's credentials and SSH tunnel instead of
  opening a second connection.
- **Export and import** — export a table or query to CSV or JSON from the
  table menu or the SQL panel, and import a CSV into a table with a
  column-mapping preview before it runs.
- **The toolbar and the native menu now show only the engine you're using** —
  PostgreSQL actions when a PostgreSQL connection or tab is in focus,
  MongoDB actions otherwise — and the engine picker is a dropdown so it
  scales to more engines later.
- **Large PostgreSQL result sets scroll smoothly** — the grid now
  virtualizes rows instead of rendering all of them at once.
- **Fixed** — the Search in Schema, History and Grants dialogs keep their
  controls in view instead of being squeezed off the dialog.
- **Fixed** — the native menu on macOS attaches correctly after the window
  is recreated, and it no longer prints GTK warnings on Linux when it
  rebuilds.
- **Fixed** — Ctrl+Tab and Ctrl+Shift+Tab switch tabs reliably, and
  rebinding a shortcut keeps Ctrl and Cmd distinct instead of merging them.
- **Fixed** — the sidebar selection and the native menu's enabled state stay
  in sync when a tab is locked, closed, renamed, or you switch tabs.
- **Fixed** — a renamed table or schema updates its own open tabs, not just
  the sidebar.
- **Fixed** — the page-size and column-picker dropdowns close on an outside
  click or Escape, and a PostgreSQL column stays wide enough to show its own
  header.

## v0.2.0

- **PostgreSQL (preview)** — OzenDB now connects to PostgreSQL as well as
  MongoDB. Pick the engine in the connection editor, or paste a
  `postgresql://` connection string; SSH tunnels work for both. It is a
  preview: expect rough edges, and please report what you hit.
  - Browse schemas, tables and their columns in the sidebar, with estimated
    row counts. PostgreSQL's own schemas can be shown or hidden.
  - Open a table in its own tab: filter from boxes under the column headers,
    sort, page, pick which columns to show, and edit cells in place —
    including arrays, enums (as a dropdown) and setting a value to NULL.
  - Join related tables through their foreign keys, including keys over
    several columns, from the Query Builder.
  - Switch any table tab to SQL and back; edited SQL is read back into the
    filters and the Query Builder where it can be.
  - A SQL tab runs any statement — queries, INSERT/UPDATE and DDL — with
    Format SQL, Explain with the real plan and timings, Cancel, saved
    queries and run history. Manual transactions hold open across runs until
    you Commit or Roll back. Statements stop after five minutes.
  - The results grid supports cell and row selection, keyboard navigation,
    copy, column resize, auto-fit and drag-to-reorder.
  - Other databases on the same server are listed in the sidebar; open one in
    its own SQL tab, which reuses the connection's credentials and SSH tunnel
    rather than opening a second connection.
- **Current Operations is now a live tab** — filter by namespace, age and
  kind, see plan, app, user and waiting details, switch to JSON or Tree view,
  and kill an operation. Several can be open at once, and they survive a
  restart.
- **Report a problem from the Help menu** — OzenDB records its own errors so
  a bug report can include them, with your home folder scrubbed from paths.
- **Query timing is measured on the server**, not the round trip, and the
  footer counts up while a query runs.
- **Refresh shortcuts** — Ctrl/Cmd+R refreshes the active tab, and
  Ctrl/Cmd+Shift+R refreshes every connection.
- **Middle-click closes a tab**, and each connection in the sidebar shows an
  engine badge.
- **Editing a connection that is open** no longer silently points it at a
  different server — you're offered to save it as a new connection instead,
  which keeps its password.
- **Fixed** — a read-only connection now blocks every way of writing, and
  its lock is remembered between sessions.
- **Fixed** — Test Connection tests the connection exactly as it will be
  opened, including over SSH.
- **Fixed** — tabs pointing at a renamed collection follow the rename, and
  tabs that are already open aren't restored a second time.
- **Fixed** — you're told when the saved session couldn't be restored,
  instead of starting empty without a word.
- **Fixed** — Cancel stops a query even when the server has nothing left to
  kill.
- **Fixed** — the macOS app icon is the same size as other apps' icons, and
  the Linux AppImage shows its icon.

## v0.1.4

- **Automatic updates** — OzenDB now checks for new versions on launch and from
  Help → Check for Updates…, and can install them itself. **This release must be
  installed by hand; updates are automatic from the next one on.** Linux `.deb`
  and `.rpm` installs are managed by your package manager, so they're pointed at
  the downloads page instead of updating in place.
- **Copying works again on Linux** — copying a cell, a document or a selection
  silently did nothing. The window never asked the webview for clipboard access,
  so every copy in the app was rejected without an error.
- **Zoom the whole interface** — zoom in and out from the View menu, remembered
  between launches.
- **Database and collection stats on hover** — hovering a node in the sidebar
  shows its size, document count and index count without opening it.
- **F3 opens the selected document** in the viewer window, and the keyboard
  shortcut settings are now grouped by area.
- **Fixed** — connection colour tags now load at startup, so tabs show them after
  a restart instead of only once you expand the connection.
- **Fixed** — the text caret is full height in empty query fields.
- macOS builds are ad-hoc signed, which is what Apple Silicon requires to run
  them at all. They are still not notarized, so first launch still needs the
  right-click → Open path.

## v0.1.3

- **Paste documents from the clipboard** — Ctrl+V in the results grid, or
  Edit → Paste Document(s), inserts the clipboard's document(s) into the open
  collection after a confirmation dialog showing what and where. Also fixes
  clipboard reads on Linux, where they previously always failed.
- **Momentum scrolling** — touchpad swipes keep gliding after your fingers
  lift, in the table, JSON and tree result views, the pop-out document window
  and every code editor.
- **Aggregation pipeline editor** — the pipeline now uses the full code editor
  with syntax highlighting and bracket matching, grows with its content, and
  can be resized without pushing the results off screen.
- **Export source picker** — export the entire collection, just the current
  query's results, or only the selected documents. The output format moved to
  the header so it's chosen before the field mapping.
- **Export wizard as a workspace tab** — export opens as a tab instead of a
  modal, with tab navigation and a full-width working area.
- **Read-only connections are properly enforced** — `runCommand` writes and
  `$out` / `$merge` pipeline stages are now refused, closing two paths that
  bypassed the read-only guard.
- **Real error messages from MongoDB** — when the server rejects a command,
  its own message reaches the UI instead of a generic failure.
- **Preferences pane** — keyboard shortcuts, default result view, session
  restore, and editor indentation are configured in one place.
- **Drag-to-reorder tabs and columns** — reorder workspace tabs, and reorder
  columns in table view, by dragging.
- **Document count on the button** — the total shows inline on the Count
  button, with right-click to copy it.
- **Colour tags** — pick a custom colour through the native colour picker;
  recent choices are remembered.
- **Stale credentials are cleaned up** — editing a connection now removes any
  keychain secret it can no longer use.
- **Removed** — the data masking feature, the background task scheduler and
  its Tasks tab, and the duplicate Connect popup (Ctrl+N now opens the
  connection manager).

## v0.1.2

- **Declarative modal registry** — all top-level modals now render from a
  single registry, making each modal a lazy-loaded component with no wiring
  beyond one row of config. GridFS, export/import wizards, validator, masking,
  and reschema modals all moved into the registry.
- **Workspace tabs for tools** — SQL, Schema, Masking, Reschema, Compare,
  Tasks, and Search now open as workspace tabs instead of modals, giving them
  tab navigation, persistence, and a full-width working area.
- **Search redesigned** — new results grid with scope controls, match-case,
  regex toggles, and database/collection pickers.
- **SQL as per-collection tab** — SQL opens as a collection tab in `sql`
  mode, reusing the full result stack (grid, paging, Query Code, Explain).
  Backed by the `sqlparser` crate instead of a hand-rolled parser.
- **Escape-to-close everywhere** — all modals consistently close on Escape
  via BaseModal. Pop-out document windows also close on Escape.
- **Toast via provide/inject** — `showToast` is now provided app-wide instead
  of being bubbled through events, simplifying every component that needs it.
- **Linux Tab shortcut fix** — Ctrl+Tab / Ctrl+Shift+Tab now work on Linux
  (WebKitGTK was reporting Shift+Tab as Unidentified).
- **Data import** — Studio-3T-style CSV import with configurable parsing
  options, plus a JSON import tab and an import-format picker.
- **Unified component library** — every button, input, select, textarea,
  checkbox, radio, modal, and form field now routes through a shared base
  component, giving the app a consistent look and feel.
- **3T-style update/delete dialogs** — tabs, upsert/multi toggles, JSON
  validation, and a predefined-query selector, matching the shape users
  expect from Studio 3T.
- **Find-in-results bar** — search across table, JSON, and tree result views
  without scrolling.
- **Multi-row selection in table view** — shift-click ranges, ctrl-click
  disjoint rows, ctrl+a select-all, bulk copy and delete.
- **Index management tab** — full index create/drop workflow in a dedicated
  tab, with per-collection state preserved across sessions. Index operations
  are tracked in the Operations pane.
- **Operations pane** — long-running exports, imports, and index operations
  surface progress in a dedicated panel.
- **Quickstart tab** — interactive landing page with recent connections,
  common tasks, options, and help links.
- **Tab navigation** — Ctrl+Tab / Ctrl+Shift+Tab to cycle tabs. Index Manager
  and VQB state persist across restarts.
- **Pop-out document insert** — new documents open in a separate window
  instead of a modal.
- **Better error surfacing** — real MongoDB write-error messages (e.g.
  duplicate key) now reach the UI instead of being swallowed.
- **Linux desktop integration** — correct `StartupWMClass` and `Categories`
  so the app icon appears in the dock and task switcher.
- **CI** — pull-request test workflow runs `cargo test` and `vitest` on every
  PR.

## v0.1.1

- **Reduced memory usage after large queries** — switched to the mimalloc
  allocator and stream query results as pre-serialized JSON, cutting retained
  memory after a big fetch by roughly two-thirds.
