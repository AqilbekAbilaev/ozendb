**Status:** done

# Work 1A: Application API Boundary

## Goal

Move every engine-neutral custom Tauri command behind named modules in:

```text
src/appApi/
```

After completion, components, composables, stores, and utilities do not call custom backend commands directly.

This complements the completed MongoDB boundary:

```text
src/appApi/                       Engine-neutral application commands
src/engines/mongodb/api/         MongoDB-specific commands
```

Work 1 remains complete. Work 1A must finish before Work 2 begins.

## Architecture Decision

The two API boundaries have different ownership:

- `src/appApi/` owns application, platform, presentation, and reusable transport concerns.
- `src/engines/mongodb/api/` owns MongoDB query, document, resource, administration, transfer, GridFS, schema, and shell concerns.

Engine-neutral commands must never move under the MongoDB adapter.

## Boundary Rules

- API modules contain no Vue state.
- API modules contain no toasts or UI error handling.
- API modules do not swallow errors.
- API functions accept semantic arguments rather than raw backend payloads.
- API functions own exact command names and wire payload translation.
- Responses pass through unless normalization is intentional and documented.
- Consumers never receive a generic `call(command, payload)` escape hatch.
- Official Tauri plugin APIs such as dialog, opener, event, and window may remain directly imported.
- Only custom backend `invoke()` calls are governed by this boundary.

## Application API Modules

```text
src/appApi/
  settings.js
  session.js
  menu.js
  errorLog.js
  operations.js
  folders.js
  tags.js
  connectionState.js
  sshTrust.js
  files.js
  updater.js
```

| Module | Responsibility |
|---|---|
| `settings.js` | Settings and keyboard bindings |
| `session.js` | Open-workspace persistence |
| `menu.js` | Native menu context |
| `errorLog.js` | Error records and frontend error reporting |
| `operations.js` | Application operation registry |
| `folders.js` | Connection folders |
| `tags.js` | Connection/database/collection colors |
| `connectionState.js` | Sidebar open state and last-accessed time |
| `sshTrust.js` | Host-key prompts and remembered hosts |
| `files.js` | Generic text staging and script file I/O |
| `updater.js` | Update capability checks |

Every module has a colocated wire-contract test.

## Command Ownership

### Settings

```text
get_settings
update_settings
get_keybindings
update_keybindings
```

### Session

```text
get_open_tabs
set_open_tabs
```

### Menu

```text
set_menu_context
```

### Error Log

```text
list_error_log
clear_error_log
error_report_context
record_frontend_error
```

### Operations

```text
list_operations
clear_operations
```

### Folders

```text
list_folders
create_folder
rename_folder
delete_folder
move_connection_to_folder
```

### Tags

```text
get_node_tags
set_node_tag
clear_node_tags_under
set_connection_tag
```

### Connection Presentation State

```text
set_connection_open
update_last_accessed
```

### SSH Trust

```text
respond_ssh_host_key
forget_ssh_host
```

### Generic Files

```text
stage_import_text
read_shell_script
write_shell_script
```

### Updater

```text
can_self_update
```

## Connection Catalog Decision

Connection catalog operations should eventually become engine-neutral:

```text
list connections
save/update/delete connection
disconnect
duplicate/import/export connections
```

They currently expose MongoDB-specific configuration fields, so they remain in the MongoDB API until the backend introduces an engine-discriminated `ConnectionProfile`.

After that migration, generic catalog commands move to `src/appApi/connections.js`, while engine adapters retain engine-specific configuration validation and connection testing.

Do not move the current Mongo-shaped connection DTO into `appApi` prematurely.

## Phase 1: Correct API Contracts

### Settings

- Use an object fixture for keybindings, matching Rust's map contract.
- Preserve camelCase update payloads.
- Preserve snake_case backend responses.

### Menu

Move `setMenuContext()` out of the session API and into:

```text
src/appApi/menu.js
src/appApi/menu.test.js
```

Test the complete payload:

```js
{
  hasConnection,
  hasDatabase,
  hasCollection,
  anyConnection,
  hasDocument,
  hasField,
  hasIndex,
  readOnly,
}
```

### Error Log

Use accurate names:

```js
listErrorLog()
getErrorReportContext()
clearErrorLog()
recordFrontendError(message)
```

`recordFrontendError()` owns string conversion and the 4,000-character limit.

### Operations

Use `clearFinishedOperations()` rather than `clearOperations()`, because the backend preserves running operations.

### SSH Trust

Use `sshTrust.js` rather than broad `ssh.js` naming. Test numeric request IDs.

### Folder And Tag Tests

- Verify `folderId: null` when moving a connection to the root.
- Use the existing slash-separated node-tag key format.

## Phase 2: Settings And Keybindings

Migrate:

```text
src/App.vue
src/components/app/PreferencesModal.vue
src/composables/useZoom.js
```

Use:

```js
getSettings()
updateSettings(patch)
getKeybindings()
updateKeybindings(bindings)
```

The App migration must be atomic. Removing the Tauri import before converting every call creates runtime `ReferenceError`s.

Preserve startup ordering:

1. Load settings.
2. Apply theme and defaults.
3. Decide whether to restore the session.
4. Create defaulted workspaces.

## Phase 3: Session And Menu

Migrate:

```text
src/composables/useSessionPersistence.js
src/composables/useMenu.js
```

Use:

```js
getOpenTabs()
setOpenTabs(session)
setMenuContext(context)
```

Preserve debounced fire-and-forget saves, current swallowed save failures, complete menu payloads, and reactive update timing.

Session schema redesign remains Work 7.

## Phase 4: Connection Presentation

Migrate:

```text
src/composables/useConnectionTree.js
src/components/panes/QuickstartPane.vue
src/components/connection/ConnectionManager.vue
```

Use:

```js
setConnectionOpen(connectionId, open)
updateLastAccessed(connectionId, timestamp)
```

This also eliminates undeclared `invoke` references in current callers.

## Phase 5: Folders And Tags

Migrate:

```text
src/composables/useConnectionFolders.js
src/composables/useNodeTags.js
```

Preserve:

- `folderId: null` when moving to root.
- Optimistic local tag updates.
- Existing swallowed persistence errors.
- Existing node-tag key encoding.

## Phase 6: Operations, Updater, And SSH Trust

Migrate:

```text
src/composables/useOperations.js
src/composables/useUpdater.js
src/composables/useUpdater.test.js
src/composables/useSshHostKey.js
```

Consumer tests should mock application API modules rather than raw Tauri transport.

Preserve awaited versus fire-and-forget behavior exactly.

## Phase 7: Generic File Operations

Migrate:

```text
src/components/panes/CsvImportPane.vue
src/components/panes/ImportPane.vue
src/components/app/ShellConsole.vue
```

Use:

```js
stageImportText(content, format)
readShellScript(path)
writeShellScript(path, contents)
```

Keep path string conversion and current failure handling.

## Phase 8: Error Reporting

Migrate:

```text
src/components/app/ErrorReportModal.vue
src/utils/errorReport.js
```

The modal uses:

```js
listErrorLog()
getErrorReportContext()
clearErrorLog()
```

The global recorder uses:

```js
recordFrontendError(message).catch(() => {})
```

Preserve the per-session cap, fire-and-forget behavior, recursion safety, and empty-state behavior.

## Reviewable Execution Order

Every checkpoint touches at most three files.

1. Correct settings, SSH trust, and tag contract fixtures.
2. Add and test the menu API.
3. Separate menu from session and migrate `useMenu`.
4. Finish all App settings and keybinding calls.
5. Migrate Preferences and zoom.
6. Migrate session persistence.
7. Migrate folders.
8. Migrate tags.
9. Migrate connection presentation state.
10. Migrate operations with accurate naming.
11. Migrate SSH trust.
12. Migrate updater and its consumer test.
13. Migrate staged import text.
14. Migrate shell-script file I/O.
15. Migrate Error Report modal.
16. Migrate global frontend error recording.
17. Add the unified application boundary guard.
18. Reconcile documentation and mark Work 1A done.

## Test Strategy

Each API test mocks `@tauri-apps/api/core` and verifies:

- Exact command name.
- Exact backend payload.
- Response pass-through.
- Error pass-through.
- Intentional normalization or truncation.

Consumer tests should mock their API module rather than raw `invoke()` after migration. This keeps command names and wire payload knowledge inside API tests.

## Boundary Guard

Add:

```text
src/appApi/apiBoundary.test.js
```

The guard scans production `.js`, `.vue`, `.ts`, and `.tsx` files.

Allowed custom-command roots:

```text
src/appApi/
src/engines/*/api/
```

Everywhere else it rejects:

- Imports of `@tauri-apps/api/core`.
- Bare `invoke(...)` calls, including calls with no import.

Exclude test files from the production import rule so tests can mock transport dependencies.

Maintain command ownership:

- Application commands may only appear under `src/appApi`.
- MongoDB commands may only appear under `src/engines/mongodb/api`.

Do not add a generic transport escape hatch.

## Out Of Scope

- Wrapping official Tauri plugin APIs.
- Introducing a universal transport service.
- Normalizing settings response naming.
- ResourceRef and resource hierarchy changes.
- Session schema version 2.
- Workspace definitions.
- Modal routing.
- Rust command or payload changes.
- Refactoring existing error handling or listener lifecycles.

## Verification

After each domain:

```bash
npm test -- src/appApi/<domain>.test.js
npm run check:size
```

Final:

```bash
npm test
npm run check:size
npm run build
git diff --check
```

Final source search:

```bash
rg -n --glob '*.{js,vue,ts,tsx}' '\binvoke\s*\(' src \
  | rg -v '/src/appApi/|/src/engines/.*/api/'
```

Expected result: no production custom-command invocation outside the two API boundaries.

## Risks

- Changing awaited calls into fire-and-forget calls or the reverse.
- Losing existing swallowed-error behavior.
- Altering camelCase request fields or snake_case settings responses.
- Losing `folderId: null` semantics.
- Sending incomplete menu context.
- Double-truncating or failing to truncate frontend errors.
- Leaving partially migrated files with missing `invoke` imports.
- Growing `App.vue`, which is already at its file-size ceiling.

## Acceptance Criteria

- All 30 engine-neutral commands have named `src/appApi` functions.
- All production callers use those functions.
- No production component, composable, store, or utility imports Tauri core.
- No production code outside API roots calls `invoke()`.
- Menu context has its own cohesive module.
- Engine-neutral commands never appear under MongoDB APIs.
- Existing return values, catches, errors, state mutations, and async timing remain unchanged.
- Application and MongoDB boundary guards pass.
- Tests, file-size check, production build, and final source search pass.
- Work 1 remains `done`.
- Work 1A is marked `done` before Work 2 begins.
