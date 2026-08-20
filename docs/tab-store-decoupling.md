**Status:** not started

# Work 8: Decouple The Tab Store From Engines

## Goal

Remove the mutable `setRunRestoredTab` callback, `_restored` knowledge, and any remaining backend or MongoDB behavior from `src/stores/tabs.js`.

The store should own only workspace collection state and generic mutations. Engine-specific initial execution belongs to the active engine workspace/controller; disposal already belongs to definitions after Work 6.

## Dependencies

- Work 6 routes duplication and disposal through definitions.
- Work 7 restore sets a runtime-only `needsInitialRun` marker for restored find workspaces.
- Work 3 provides `MongoCollectionWorkspace.vue` as the owner of Mongo query behavior.
- Mongo shell cleanup is available through the shell API and definition disposal.
- All direct array-filter removal paths use `closeWhere()`.

## Target Ownership

After this work:

| Concern | Owner |
|---|---|
| Tab array/order/active ID | `stores/tabs.js` |
| Duplicate/disposal | Workspace definitions via generic lifecycle helpers |
| Restored find initial run | Mongo collection workspace/controller |
| Shell close command | Mongo shell API through shell definition |
| Session restore marker | Runtime field created by restore definition |

## Restored Find Execution

The current flow stores an App-created closure in a module-scope store. Replace it with active workspace ownership:

1. Find restore creates `needsInitialRun: true` in runtime state.
2. `MongoCollectionWorkspace` observes its active workspace immediately and on workspace changes.
3. The Mongo find controller checks and clears the marker synchronously.
4. It parses the restored fields and runs through the normal query path.
5. Repeated activation does not rerun automatically.

Exactly-once rules:

- The active restored find runs after hydration.
- An inactive restored find runs on first activation.
- Repeated activation does not trigger another automatic run.
- Failure remains a single attempt, matching current behavior.
- Aggregate and SQL never auto-run.
- The marker is never serialized.

Do not reuse `needsInitialRun` for document-saved refresh. That is an explicit refresh action, not restoration lifecycle.

## Store Contract

The generic store retains:

```text
tabs
activeTabId
activeTab
activateTab
closeTab
closeWhere
closeTabsExcept
closeTabsToSide
closeAllTabs
moveTab
moveTabToFront
cycleTab
rename behavior
```

It must not import:

```text
@tauri-apps/api/core
Mongo API modules
query runners/controllers
shell modules
```

## Reviewable Changes

### Change 8A: Initial-Run Controller

Files: no more than 3

Suggested files:

```text
src/engines/mongodb/workspaces/collection/useInitialFindRun.js
src/engines/mongodb/workspaces/collection/useInitialFindRun.test.js
src/engines/mongodb/workspaces/collection/MongoCollectionWorkspace.vue
```

The controller/helper:

- Detects `mongodb.find` only.
- Checks `needsInitialRun`.
- Clears it before execution.
- Parses filter, projection, and sort with current rules.
- Calls the normal run entry point.
- Does nothing for aggregate, SQL, or already-consumed workspaces.

Tests:

- Active restored find runs once.
- Repeated checks do not rerun.
- Inactive find does not run until rendered/activated.
- Aggregate and SQL do not run.
- Marker clears before the asynchronous request begins.
- Query arguments match the current restored-run behavior.

### Change 8B: Remove Store Callback And Backend Knowledge

Files: 3

1. Update `src/stores/tabs.js`.
2. Update `src/stores/tabs.test.js`.
3. Update `src/App.vue`.

Remove:

- `setRunRestoredTab`.
- Module-level `runRestoredTab` callback storage.
- `_restored` branch in `activateTab()`.
- Direct shell command invocation, if any remains after Work 6.
- App callback registration and related comments.

Store tests cover:

- Activation changes only active state.
- Unknown activation is safe.
- Close delegates generic disposal once.
- Disposal failure does not prevent removal.
- Bulk close behavior remains correct.
- Selection repair, cycling, reorder, rename, and color behavior remain unchanged.
- Tests no longer mock Tauri or Mongo APIs.

### Change 8C: Remove Obsolete Query-Runner Restore API

Files: 2

1. Update `src/composables/useQueryRunner.js`.
2. Update `src/composables/useQueryRunner.test.js`.

Remove `runRestoredTab()` after all callers are gone. Keep normal run, aggregate, and cancellation behavior unchanged.

### Change 8D: Normalize Activation Call Sites

Use checkpoints of at most three files.

Replace direct `activeTabId.value = id` writes outside hydration/store internals with `activateTab(id)` where practical. This gives one mutation path and ensures future generic activation observation remains predictable.

Search acceptance:

```bash
rg -n "activeTabId\.value\s*=" src --glob '*.js' --glob '*.vue'
```

Expected remaining writes should be limited to the store and controlled session hydration.

## Document-Saved Refresh

`App.vue` currently reruns matching collection tabs after a pop-out document save. Preserve that behavior explicitly:

- Do not set a restoration marker.
- Call the normal find refresh operation for matching open find workspaces.
- Aggregate and SQL behavior remains unchanged.

Moving the listener out of App can be a later ownership cleanup.

## Failure Handling

- Initial-run errors appear in normal query runtime state.
- Clearing the marker before running prevents re-entry.
- Disposal failure never restores a closed tab.
- Missing workspace definitions are programming errors and must not reinterpret the workspace type.
- No async lifecycle promise should become an unhandled rejection.

## Behavior Invariants

- Active restored find runs once.
- Inactive restored find waits for first activation.
- Aggregate and SQL remain manual.
- Closing remains visually synchronous.
- Shell cleanup remains best-effort.
- Tab order, focus fallback, cycling, rename, and color remain unchanged.
- HMR cannot retain an App-level query-runner closure in the module store.

## Out Of Scope

- Moving the document-saved event out of App.
- Changing query parsing or invalid-filter fallback.
- Awaiting backend disposal before close.
- Cancelling running queries on close.
- Resource invalidation.
- A complete workspace store rewrite.
- Changing Rust shell behavior.

## Verification

```bash
npm test -- src/engines/mongodb/workspaces/collection/useInitialFindRun.test.js
npm test -- src/stores/tabs.test.js
npm test -- src/composables/useQueryRunner.test.js
npm test
npm run check:size
npm run build
```

Searches:

```bash
rg -n "setRunRestoredTab|_restored" src
rg -n "@tauri-apps/api/core|close_shell_session" src/stores/tabs.js
```

Expected result: no matches.

## Risks

- Clearing the marker after awaiting allows duplicate runs.
- Direct active-ID writes can bypass future activation coordination.
- Reusing restoration state for ordinary refresh recreates lifecycle ambiguity.
- Removing callback registration before the active workspace owns initial execution breaks lazy restore.

## Acceptance Criteria

- `tabs.js` contains no Tauri or engine import.
- `setRunRestoredTab` no longer exists.
- `_restored` no longer exists.
- App does not register behavior into the tab store.
- Restored find execution is owned and tested by the Mongo collection workspace/controller.
- Shell cleanup remains definition/API owned.
- Store tests contain no backend command knowledge.
- Existing tab interaction behavior remains unchanged.
- Tests, size check, and production build pass.
