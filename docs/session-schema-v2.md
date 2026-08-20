**Status:** not started

# Work 7: Session Schema Version 2

## Goal

Introduce a versioned, engine-aware session envelope, migrate every supported legacy tab shape into canonical workspace records, and prevent unsupported or unreadable sessions from being silently overwritten.

Migration is a frontend responsibility. Rust continues storing opaque JSON.

## Dependencies

- Work 2 ResourceRef and legacy target adapters.
- Work 4 workspace registry.
- Work 5 construction definitions.
- Work 6 restore and disposal definitions.
- Explicit persistence decisions for Quickstart, Schema, Search, and import field mappings.

## Session V2

```js
{
  schemaVersion: 2,
  activeTabId: 'workspace-1',
  tabs: [
    {
      id: 'workspace-1',
      type: 'mongodb.find',
      engine: 'mongodb',
      title: 'users',
      color: null,
      target: {
        connectionId: 'connection-1',
        segments: [
          { kind: 'database', name: 'app' },
          { kind: 'collection', name: 'users' },
        ],
      },
      state: {
        filter: '{ active: true }',
        projection: '',
        sort: '{ createdAt: -1 }',
        skip: 0,
        limit: 50,
      },
    },
  ],
}
```

## Invariants

- Saved `schemaVersion` is exactly `2`.
- IDs are unique and non-empty.
- `activeTabId` is `null` or identifies a persisted record.
- Tab order is preserved.
- Resource targets contain identity only.
- Connection display names are not identity.
- Durable state is owned by the workspace definition.
- Runtime data is never persisted.
- Serialized data is detached from Vue proxies and live mutable objects.

## Definition Serialization Contract

Extend workspace definitions with:

```js
serialize(workspace) {
  return { /* durable engine-owned state */ }
}
```

The session service owns the common envelope. Definitions own only their durable `state` projection and existing restore behavior.

## Migration Result

Use an explicit result rather than treating every problem as an empty session:

```js
// Safe to restore and save.
{
  ok: true,
  session,
  sourceVersion: 1 | 2,
  migrated: boolean,
  warnings: [],
}

// Unsafe to restore or overwrite.
{
  ok: false,
  reason: 'invalid-session' | 'future-version' | 'unknown-workspace-type',
  schemaVersion,
}
```

Autosave starts disabled and is enabled only after successful inspection.

## Version Rules

- Missing `schemaVersion` means legacy v1.
- `schemaVersion: 1` means legacy v1.
- `schemaVersion: 2` is validated and normalized.
- Numeric versions greater than 2 are future versions and must not be overwritten.
- Invalid versions are unsafe and must not be overwritten.

## Legacy Type Mapping

| Legacy shape | V2 type |
|---|---|
| Collection with missing/empty/find mode | `mongodb.find` |
| Collection with aggregate mode | `mongodb.aggregate` |
| Collection with SQL mode | `mongodb.sql_to_mql` |
| Shell | `mongodb.shell` |
| Indexes | `mongodb.indexes` |
| Schema | `mongodb.schema` |
| Search | `mongodb.search` |
| Import | `mongodb.import` |
| Export | `mongodb.export` |
| Current Operations | `mongodb.current_operations` |
| Quickstart | `app.quickstart`, only if persistence is approved |

Unknown kinds and unknown collection modes must not silently become find workspaces.

## Target Migration

Use Work 2 adapters:

- Long collection fields: `connectionId`, `dbName`, `collectionName`.
- Short tool fields: `connId`, `dbName`, `collName`.
- Shell is database-scoped.
- Current Operations is connection-scoped even when its filters are populated.
- Import's launch collection is its target; per-source destinations remain state.

Names remain raw strings. Never parse resource identity with `/` or `.`.

## ID And Active Selection Repair

- Preserve the first valid record for an ID.
- Drop later records with duplicate IDs.
- Do not generate replacement IDs for corrupted duplicates.
- Preserve relative order among surviving records.
- Drop records with missing or invalid IDs.
- Keep `activeTabId` only if it identifies a survivor.
- Otherwise select the first surviving persisted record or `null`.

## Connection Validation

- Load the connection list successfully before pruning.
- Drop connection-bound workspaces whose connection no longer exists.
- Keep app-level workspaces.
- If connection loading fails, do not interpret that as every connection being deleted.
- A connection-load failure blocks restore and autosave for that launch.

## Exact Text Preservation

Migration copies editor text without parsing, trimming, or fallback normalization:

```js
state.filter = legacy.filter ?? ''
```

Preserve exactly:

- Find filter, projection, and sort.
- Aggregate pipeline.
- SQL text.
- Shell code.
- Export frozen filter.

## Runtime Exclusion

Never migrate or serialize:

```text
results/documents
loading/running flags
errors and error codes
selection
timings and run IDs
explain results
search hits
schema reports
current operation rows
shell session IDs/history/output/logs/scalars
import previews
export result banners
_restored
runtime supplied by persisted input
```

Definitions reconstruct runtime defaults.

## Failure Policy

| Condition | Restore | Save during launch |
|---|---|---|
| Missing file | Use initial workspace | Enabled |
| Valid v1 | Migrate and restore | Enabled; rewrite v2 |
| Valid v2 | Restore | Enabled |
| Future schema | Do not restore | Disabled |
| Unknown v2 type | Do not partially restore | Disabled |
| Malformed envelope | Do not restore | Disabled |
| Backend load failure | Do not restore | Disabled |
| Connection-list failure | Do not prune/restore | Disabled |
| Invalid legacy records | Skip with warnings | Enabled after successful migration |
| Save failure | Keep in-memory state | Retry on later durable change |

Always inspect the persisted file even when session restoration is disabled. Otherwise a downgraded app could overwrite a future session schema.

## Autosave And HMR

Expose:

```js
initializeSession({ restore })
startAutoSave()
stopAutoSave()
```

Requirements:

- Initialization always loads and validates.
- Autosave is idempotent.
- Keep and stop the Vue watcher.
- Cancel pending debounce timers on stop.
- Ignore async initialization after the owner is stopped.
- Restoration cannot trigger an immediate empty/default write.
- Runtime-only changes do not schedule saves.
- Successful v1 migration explicitly writes v2.
- Stale HMR instances cannot save.
- App calls cleanup from `onUnmounted()`.

## Reviewable Changes

### Change 7A: Pure Migration And Fixtures

Files: 3

1. Add `src/utils/sessionMigration.js`.
2. Add `src/utils/sessionMigration.test.js`.
3. Add `src/utils/sessionMigration.fixtures.js`.

Fixtures:

- Every legacy type.
- Exact expected v2 output.
- Duplicate IDs and stale active ID.
- Deleted connection.
- Empty session.
- Names with `/`, `.`, spaces, and Unicode.
- Whitespace-sensitive query text.
- Missing mode.
- Unknown kind/mode.
- Valid v2 normalization.
- Unknown v2 type.
- Future v3 session.
- Malformed envelopes.
- Runtime field stripping.
- Input immutability.

### Change 7B: Definition Serialization

Use separate two-file checkpoints:

```text
queryDefinitions.js
queryDefinitions.test.js

toolDefinitions.js
toolDefinitions.test.js

appDefinitions.js
appDefinitions.test.js
```

Add and test durable-state projection for every supported type.

### Change 7C: Session Service Adoption

Files: 3

1. Update `src/composables/useSessionPersistence.js`.
2. Update `src/composables/useSessionPersistence.test.js`.
3. Update `src/App.vue` for initialization and cleanup.

Tests use fake timers and cover:

- Restore before autosave.
- No duplicate initialization.
- Debounce coalescing.
- Runtime changes do not save.
- Durable changes save v2.
- Stop cancels watcher and timer.
- Future schemas never save, even with restore disabled.
- Load/connection failures block saving.
- Save rejection remains recoverable.
- Successful migration writes v2.

### Change 7D: Optional Rust Storage Hardening

Files: 2

1. Update `src-tauri/src/tabs.rs`.
2. Add `src-tauri/src/tabs.test.rs`.

Keep JSON opaque but preserve malformed files through quarantine before replacement.

Rust tests:

- Missing file.
- Arbitrary JSON round trip.
- V2 JSON round trip unchanged.
- Malformed JSON quarantine.
- Atomic save behavior.
- Save error propagation.

## Out Of Scope

- Moving migration logic into Rust.
- Persisting runtime results.
- Changing query execution semantics.
- Fixing invalid restored filters that execute broadly.
- Renaming `tabs.json`.
- Resource-tree invalidation.
- Recovering fields legacy sessions never stored.
- Converting frontend files to TypeScript.

## Verification

Frontend:

```bash
npm test -- src/utils/sessionMigration.test.js
npm test -- src/composables/useSessionPersistence.test.js
npm test
npm run check:size
npm run build
```

If Rust hardening is included:

```bash
cargo test
cargo build
```

Run Rust commands from `src-tauri/`.

## Acceptance Criteria

- Every saved session has `schemaVersion: 2`.
- Every persisted workspace uses the canonical envelope.
- Legacy sessions migrate deterministically through fixtures.
- Duplicate IDs, deleted connections, and invalid active IDs are repaired.
- Editor text is preserved exactly.
- Runtime and shell session IDs never reach disk.
- Unknown/future sessions are never overwritten.
- Protection applies even when restore is disabled.
- Autosave and HMR lifecycle are deterministic and tested.
- Frontend tests, size check, and build pass.
- Rust tests and build pass if storage hardening is included.
