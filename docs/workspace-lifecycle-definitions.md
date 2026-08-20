**Status:** done

# Work 6: Move Workspace Lifecycle Into Definitions

## Goal

Move duplicate, restore reconstruction, and disposal behavior from generic stores and session code into the workspace definitions introduced by Work 5.

This work keeps the existing unversioned persisted session format. Session schema version 2 belongs to Work 7.

## Dependencies

- Work 5 construction definitions and registry are complete.
- Work 2 provides canonical target equality and containment helpers.
- Work 1 provides `src/engines/mongodb/api/shell.js` with `closeSession()`.
- Existing opener behavior is covered by Work 5 tests.

## Lifecycle Contract

Extend definitions with optional hooks:

```js
{
  duplicate(workspace, context) {
    return { title, target, fields }
    // null means unsupported.
  },

  restore(savedWorkspace, context) {
    return { title, target, fields }
  },

  dispose(workspace, context) {
    // void or Promise<void>
  },
}
```

Generic lifecycle helpers own common metadata, IDs, deep cloning, definition lookup, and failure boundaries. Definitions never mutate the workspace array directly.

## Lifecycle Rules

- Duplicate always receives a fresh workspace ID.
- Durable nested values are deeply cloned.
- Runtime arrays, errors, results, and selection reset.
- Restore reconstructs fresh runtime state.
- Shell duplicate and restore create fresh backend session IDs.
- Disposal starts without delaying visual tab closure.
- Disposal failure never prevents closure or resurrects a tab.
- Missing optional disposal is a no-op.
- Unknown types fail clearly rather than becoming collection workspaces.
- Serialization remains in the session service until Work 7.
- Activation and lazy restored-query execution remain on the current bridge until Work 8.

## Duplicate Behavior

| Workspace type | Behavior |
|---|---|
| `app.quickstart` | Unsupported |
| `mongodb.find` | Clone query/editor state, reset runtime, rerun through existing bridge |
| `mongodb.aggregate` | Clone pipeline/editor state, reset runtime, do not run |
| `mongodb.sql_to_mql` | Clone SQL text/settings, clear translated query/runtime, do not run |
| `mongodb.shell` | Clone code/script path, create fresh session, clear output/history |
| `mongodb.indexes` | Clone target, reload component data |
| `mongodb.schema` | Clone target, reload component data |
| `mongodb.search` | Clone target, reset search runtime |
| `mongodb.import` | Clone durable source/configuration, reset previews/results |
| `mongodb.export` | Clone source/filter/mapping, clear result banner |
| `mongodb.current_operations` | Clone settings/filters/view, clear operation rows |

Correct duplication for currently corrupted tool and SQL tabs is a behavior fix. Implement it as a distinct reviewed checkpoint after generic delegation is proven.

## Restore Behavior

Keep existing behavior while replacing the reconstruction chain:

- Find restores editor state and receives the existing one-shot `_restored` marker.
- Aggregate restores its pipeline and does not run.
- SQL restores SQL text, clears translated query pieces, and does not run.
- Shell restores code/script path with a fresh runtime session.
- Import restores sources/options but resets preview state.
- Export restores mapping/source/filter but clears run result.
- Indexes restores target identity only.
- Current Operations restores settings over fresh defaults.
- Schema, Search, and Quickstart remain non-persisted until Work 7 decides otherwise.

## Target Files

```text
src/workspaces/lifecycle.js
src/workspaces/lifecycle.test.js
src/engines/mongodb/workspaces/queryDefinitions.js
src/engines/mongodb/workspaces/queryDefinitions.test.js
src/engines/mongodb/workspaces/toolDefinitions.js
src/engines/mongodb/workspaces/toolDefinitions.test.js
src/stores/tabs.js
src/stores/tabs.test.js
src/composables/useSessionPersistence.js
src/composables/useSessionPersistence.test.js
```

## Reviewable Changes

### Change 6A: Generic Lifecycle Dispatch

Files: 3

1. Add `src/workspaces/lifecycle.js`.
2. Add `src/workspaces/lifecycle.test.js`.
3. Extend `src/workspaces/registry.js` for lifecycle lookup.

Tests:

- Duplicate receives a new ID.
- Common metadata is copied centrally.
- Target and durable fields are deeply detached.
- Unsupported duplicate returns a clear result.
- Unknown type fails.
- Sync and async disposal are supported.
- Disposal rejection is contained by the caller contract.

### Change 6B: MongoDB Query Lifecycle Hooks

Files: 2

1. Update `queryDefinitions.js`.
2. Update `queryDefinitions.test.js`.

Cover find, aggregate, SQL-to-MQL, and shell duplicate/restore behavior plus shell disposal.

Tests:

- Query text is preserved exactly.
- Find receives fresh runtime and current rerun marker.
- Aggregate and SQL do not run.
- SQL translated fields reset.
- Shell session IDs are fresh.
- Shell history, logs, results, and scalar state reset.
- Shell disposal calls `closeSession()` exactly once when applicable.
- Nested VQB and column-order state is not shared.

### Change 6C: MongoDB Tool Lifecycle Hooks

Files: 2

1. Update `toolDefinitions.js`.
2. Update `toolDefinitions.test.js`.

Cover Indexes, Schema, Search, Import, Export, and Current Operations.

Tests:

- CSV and JSON import restore defaults safely.
- JSON sources and CSV options are detached.
- Export mapping persists while runtime result clears.
- Current Operations settings restore over fresh defaults.
- Operation arrays, result arrays, and maps are fresh.
- Non-persisted tools remain marked non-persisted.

### Change 6D: Store Delegation

Files: 2

1. Update `src/stores/tabs.js`.
2. Update `src/stores/tabs.test.js`.

Changes:

- `duplicateTab()` delegates to the source definition.
- `closeTab()` delegates disposal.
- Add `closeWhere(predicate)`.
- Bulk close continues routing through `closeTab()`.
- Existing active-tab fallback remains unchanged.

Tests:

- Disposal runs once per removed workspace.
- Close remains synchronous with async disposal.
- Disposal errors do not block removal.
- Bulk close does not skip tabs while splicing.
- Duplicate appends and activates.
- Unsupported duplicate does nothing.
- A tool workspace cannot become a collection workspace.

The existing restored-query callback may remain until Work 8.

### Change 6E: Generic Legacy Restore

Files: 2

1. Update `src/composables/useSessionPersistence.js`.
2. Add `src/composables/useSessionPersistence.test.js`.

Replace per-kind runtime reconstruction with definition lookup and `restoreWorkspace()` while keeping the projected JSON byte-for-byte compatible at the object-field level.

Tests:

- Current projected session fixture is unchanged.
- Runtime fields are excluded.
- Deleted-connection workspaces are dropped.
- Existing open IDs are not restored twice.
- Active restored find runs through the existing bridge once.
- Inactive restored find waits for activation.
- Aggregate and SQL do not auto-run.
- Shell receives a fresh session ID.
- Restore failure does not trigger destructive autosave.

### Change 6F: Route Non-UI Removal Through The Store

Use separate checkpoints of at most three files:

```text
useFeatures.js
useFeatures.test.js

DropDatabaseModal.vue
DropCollectionModal.vue
```

Replace direct `tabs.value = tabs.value.filter(...)` with `closeWhere()` using ResourceRef containment.

This ensures shell disposal and future engine hooks run for disconnect/drop paths.

Do not broaden rename or drop behavior beyond correctly identifying affected targets unless covered as a separate fix.

## Behavior Invariants

- Tab order, active fallback, cycling, rename, and color remain unchanged.
- Visual close remains immediate.
- Query editor text and options remain unchanged across duplicate/restore.
- Shell sessions are never reused after duplicate or restart.
- Active restored find remains the only query run automatically at startup.
- Existing persisted JSON remains unversioned and compatible.
- Existing persistable/non-persistable type set remains unchanged.
- Every removal path executes disposal once.

## Out Of Scope

- Session schema version 2.
- Removing `_restored` or `setRunRestoredTab`.
- Activation hooks.
- Cancelling running queries on close.
- Changing persistence eligibility.
- Fixing invalid restored filters that execute as `{}`.
- Resource-tree invalidation.
- Renaming `useTabCreators.js`.

## Verification

```bash
npm test -- src/workspaces/lifecycle.test.js
npm test -- src/engines/mongodb/workspaces/queryDefinitions.test.js
npm test -- src/engines/mongodb/workspaces/toolDefinitions.test.js
npm test -- src/stores/tabs.test.js
npm test -- src/composables/useSessionPersistence.test.js
npm test
npm run check:size
npm run build
```

## Risks

- Direct array replacement bypasses disposal.
- Shallow copies share VQB, import, export, or column state.
- Async disposal can create unhandled rejections.
- Combining delegation with new duplicate behavior can obscure regressions.
- Restore hooks must not change the persisted format before Work 7.

## Acceptance Criteria

- Duplicate and restore dispatch through registered definitions.
- The session composable contains no per-kind runtime reconstruction chain.
- The tab store contains no workspace-shape construction logic.
- Every removal path routes through `closeTab()` or `closeWhere()`.
- Shell disposal is definition-owned and best-effort.
- Existing persisted session output remains compatible.
- Every registered type has tested duplicate/restore capability.
- Tests, size check, and production build pass.
