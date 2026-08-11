# Changelog

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
