**Status:** not started

# Work 9: Move Structural Refresh Into A Resource Store

## Goal

Make resource discovery and invalidation independent of the rendered connection tree. Structural mutations should invalidate resource data directly rather than emitting `saved` through App and calling a component template ref.

This work upgrades the existing `src/stores/connectionData.js`; it does not add a competing cache.

## Dependencies

- Work 1 MongoDB resources API is complete.
- Work 2 ResourceRef utilities exist for target identity.
- Work 6 provides generic workspace close helpers for drop operations.
- Work 10 depends on this work removing the structural modal bridge.

## Current Problem

The current refresh path is:

```text
structural modal
  -> emits saved(connectionId)
  -> AppModals
  -> App.vue modalEmits map
  -> ConnectionTree template ref
  -> refreshConn(connectionId)
```

`refreshConn()` can depend on visual expansion. A collapsed connection can therefore retain stale cached databases and collections.

Other mutation paths, such as imports, clipboard copy, GridFS, and map-reduce output, use separate refresh behavior or no invalidation.

## Store Ownership

Extend `src/stores/connectionData.js` to own:

```js
connDatabases
connectionResourceLoading
connectionResourceErrors

hasLoadedData(connectionId)
ensureConnectionResources(connectionId)
refreshConnectionResources(connectionId)
invalidateConnectionResources(connectionId)
clearConnectionResources(connectionId)
```

Keep `connDatabases` exported during migration so existing consumers can move incrementally.

## Semantics

### Ensure

`ensureConnectionResources(id)` loads only when the connection has no cached data.

An empty database list counts as loaded.

### Refresh

`refreshConnectionResources(id)` always requests fresh data.

### Invalidate

`invalidateConnectionResources(id)`:

- Marks cached structure stale regardless of sidebar expansion.
- Refreshes in the background when the connection was already loaded or loading.
- Leaves an unloaded connection unloaded so first expansion fetches it.
- Never reports a successful structural mutation as failed merely because background refresh failed.
- Contains background rejection to avoid unhandled promises.

### Clear

`clearConnectionResources(id)`:

- Removes data, loading state, and errors.
- Invalidates pending responses.
- Does not reload.
- Is used for disconnect and deletion.

### Request Generations

Maintain a per-connection request generation. A response may update the cache only if its generation is still current.

This prevents:

- A late response repopulating a disconnected connection.
- A pre-mutation response overwriting post-invalidation state.
- One connection's request affecting another.

## Reviewable Changes

### Change 9A: Store Foundation

Files: 2

1. Update `src/stores/connectionData.js`.
2. Add `src/stores/connectionData.test.js`.

Tests:

- Initial empty state.
- Cached ensure behavior.
- Empty list is loaded.
- Forced refresh.
- Per-connection loading and errors.
- Error cleanup.
- Loaded versus unloaded invalidation.
- Stale response ignored after invalidate.
- Stale response ignored after clear.
- Repeated invalidation during an active request.
- `hasLoadedData()` compatibility.

### Change 9B: Tree Becomes A Store Consumer

Files: 2

1. Update `src/composables/useConnectionTree.js`.
2. Update `src/components/connection/ConnectionTree.vue`.

Changes:

- Replace direct discovery and local loading/error maps with store operations.
- Expansion uses `ensureConnectionResources()`.
- Retry/manual refresh uses `refreshConnectionResources()`.
- Disconnect uses `clearConnectionResources()`.
- Keep `refreshConn` temporarily as a compatibility delegate until callers migrate.

### Change 9C: Create Dialogs Invalidate Directly

Files: 3

1. `AddDatabaseModal.vue`.
2. `AddCollectionModal.vue`.
3. `AddViewModal.vue`.

After successful mutation:

- Call `invalidateConnectionResources(connectionId)`.
- Emit only `close`.
- Preserve current success/error behavior.

### Change 9D: Bucket And Drop Dialogs

Files: 3

1. `AddBucketModal.vue`.
2. `DropDatabaseModal.vue`.
3. `DropCollectionModal.vue`.

Bucket creation invalidates after any collection is successfully created, including partial success.

Drop dialogs retain current workspace-closing behavior through the generic store.

### Change 9E: Rename And Duplicate Dialogs

Files: 2

1. `RenameCollectionModal.vue`.
2. `DuplicateCollectionModal.vue`.

Invalidate directly and remove `saved` emission. Do not broaden tab retargeting in the same change.

### Change 9F: Remove Structural App Bridge

Files: no more than 3

1. Update `src/App.vue`.
2. Update `src/constants/modalRegistry.js` comments/metadata if needed.
3. Update relevant modal registry tests if needed.

Remove:

- `STRUCTURAL_DIALOGS`.
- `refreshConn` App helper.
- Structural entries in `modalEmits`.
- Comments describing App-owned structural refresh.

### Change 9G: Clipboard And Database Transfer

Files: 3

1. Update `src/composables/useDbActions.js`.
2. Update `src/composables/useDbTransfer.js`.
3. Update `src/App.vue` to remove dead tree-ref dependencies.

Invalidate after successful paste/import/copy.

Database import invalidates when at least one source succeeds, even if later sources fail.

### Change 9H: Workspace Imports

Files: 2

1. `ImportPane.vue`.
2. `CsvImportPane.vue`.

Invalidate directly after successful import. Remove `onWizardImported` in a separate two-file cleanup if still present.

### Change 9I: Explicit Refresh Actions

Files: no more than 3 per checkpoint

Migrate:

```text
useFeatures.js
useAppMenuActions.js
App.vue
```

Manual Refresh and Refresh All call store operations rather than the tree ref.

### Change 9J: Additional Structure Producers

Files: 2

1. `GridFsModal.vue`.
2. `MapReduceModal.vue`.

Invalidate after:

- GridFS upload that materializes a bucket.
- Bucket copy or drop.
- Map-reduce success with an output collection.

### Change 9K: Retire Refresh Ref

Files: 2

1. `useConnectionTree.js`.
2. `ConnectionTree.vue`.

Remove `refreshConn` from the composable return and `defineExpose()` after no external callers remain.

## Behavior Invariants

- Expanding an unloaded connection fetches once and shows loading.
- Empty connections do not refetch continuously.
- Discovery failures remain visible and retryable.
- Mutation success is not converted into failure by refresh failure.
- Loaded connections refresh promptly after mutation.
- Collapsed connections cannot preserve stale cached structure.
- Disconnect/delete cannot be undone by a late response.
- Invalidating one connection does not disturb another.
- Existing mutation toast and close behavior remains unchanged.
- Existing drop/rename workspace behavior remains unchanged unless handled by prior lifecycle work.

## Out Of Scope

- Moving the saved connection list out of `useConnectionTree`.
- Generic recursive hierarchy design for new engines.
- Changing MongoDB discovery response shape.
- Fixing every stale tool workspace after rename/drop.
- Automatic invalidation for arbitrary shell commands.
- Automatic invalidation for arbitrary `$out` or `$merge` aggregation pipelines.
- Backend command changes.

## Verification

```bash
npm test -- src/stores/connectionData.test.js
npm test
npm run check:size
npm run build
```

Searches:

```bash
rg -n "refreshConn|STRUCTURAL_DIALOGS" src
rg -n "emit\('saved'" src/components/admin
```

Expected result: no structural refresh bridge remains.

## Risks

- Cache invalidation without generation checks is vulnerable to stale responses.
- Background refresh rejection can become unhandled.
- Module-scope store state requires reset discipline in tests and HMR.
- Partial-success mutations need invalidation even when the operation ultimately reports an error.
- Structural mutations exist outside the eight current dialogs.

## Acceptance Criteria

- Structural modals no longer emit `saved` for tree refresh.
- App has no structural-dialog table or tree-refresh listener map.
- Structural mutations do not require `connectionTreeRef`.
- No external caller invokes `refreshConn`.
- Collapsed connections cannot preserve stale resource data after invalidation.
- Late discovery responses cannot repopulate cleared connections.
- Store tests cover races and per-connection isolation.
- Tests, size check, and production build pass.
