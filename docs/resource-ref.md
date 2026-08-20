**Status:** not started

# Work 2: Canonical ResourceRef And Compatibility Migration

## Goal

Introduce one engine-neutral representation of database resource identity, plus pure adapters for the target shapes currently used by the tree, tabs, actions, modals, and Mongo query API.

This work establishes the contract only. It does not yet change runtime events, tab state, persisted sessions, command payloads, or node-tag keys.

## Canonical Shape

`ResourceRef` uses ordered path segments rather than fixed MongoDB fields. This supports deeper resource hierarchies such as PostgreSQL database/schema/table without another redesign.

```js
{
  connectionId: 'connection-1',
  segments: [
    { kind: 'database', name: 'app' },
    { kind: 'schema', name: 'public' },
    { kind: 'table', name: 'users' },
  ],
}
```

MongoDB examples:

```js
// Connection
{ connectionId: 'c1', segments: [] }

// Database
{
  connectionId: 'c1',
  segments: [{ kind: 'database', name: 'app' }],
}

// Collection
{
  connectionId: 'c1',
  segments: [
    { kind: 'database', name: 'app' },
    { kind: 'collection', name: 'users' },
  ],
}
```

`connectionName` is presentation metadata and does not participate in resource identity.

## Current Shapes To Support

```js
// Collection and shell tabs
{ connectionId, connectionName, dbName, collectionName }

// Tool tabs, context menus, and modal targets
{ connId, connName, dbName, collName }

// Mongo query API
{ connectionId, database, collection }

// Tree selection
{ connectionId, connectionName, dbName, collectionName, kind }
```

Adapters must not infer tab scope solely from field presence. For example, `currentOps.dbName` and `currentOps.collName` are filters while the workspace itself is connection-scoped.

## Change 2A: Core ResourceRef Contract

Files:

```text
Add src/utils/resourceRef.js
Add src/utils/resourceRef.test.js
```

API:

```js
createResourceRef(connectionId, segments = [])
appendResource(ref, kind, name)

isResourceRef(value)
resourceKind(ref)
resourceName(ref)

sameResource(left, right)
isResourceAncestor(ancestor, descendant)
```

Invariants:

- `connectionId` is a non-empty string.
- Segments are ordered from shallowest to deepest.
- Every segment has a non-empty `kind` and `name`.
- Connection scope is represented by an empty segment list.
- Resource kind is derived from the final segment.
- Names remain raw strings and are never parsed by `/` or `.`.
- Display names, capabilities, and engine IDs are not part of identity.
- Helpers do not mutate their inputs.

Tests:

- Construct connection, database, and collection references.
- Construct a future database/schema/table path.
- Preserve names containing `/`, `.`, spaces, and Unicode.
- Compare structurally equal and unequal references.
- Detect parent and descendant relationships.
- Reject invalid connection IDs and invalid segments.
- Verify connection-scope behavior.
- Verify input objects and arrays are not mutated.

This change has no production consumers and therefore cannot alter application behavior.

## Change 2B: Legacy Compatibility Adapters

Files:

```text
Add src/utils/legacyResourceRef.js
Add src/utils/legacyResourceRef.test.js
```

API:

```js
resourceFromTreeSelection(selection)
resourceFromFeatureNode(node)
resourceFromMongoTarget(target)
resourceFromLegacyTab(tab)
legacyNodeTagKey(resource)
```

These functions are pure and return `ResourceRef | null`.

Tree conversion uses the explicit tree `kind` as authoritative. Feature-node conversion supports the current short aliases used by context menus and modal payloads. Mongo-target conversion supports the `{ connectionId, database, collection }` API shape.

Legacy tab conversion uses an explicit kind table:

| Current tab kind | Resource scope |
|---|---|
| `collection` | Collection |
| `shell` | Database |
| `indexes` | Collection |
| `schema` | Collection |
| `export` | Collection |
| `import` | Collection launch scope |
| `search` | Database |
| `currentOps` | Connection |
| `quickstart` | No resource |

Unknown or malformed tabs return `null` instead of throwing.

`legacyNodeTagKey(resource)` preserves the existing persisted key format:

```text
connection-id
connection-id/database
connection-id/database/collection
```

It only serializes legacy keys and never parses them. This preserves existing node colors, including collection names containing `/`.

Tests:

- Convert every current tab kind.
- Keep Current Operations connection-scoped when database and collection filters are populated.
- Convert long and short target aliases.
- Convert Mongo query API targets.
- Return `null` for missing fields and unknown tab kinds.
- Ignore connection display names during identity comparison.
- Preserve collection names containing `/`.
- Produce exactly the current node-tag keys.

## Explicitly Out Of Scope

- Adding `resource` to live tab objects.
- Modifying `useTabCreators.js`.
- Changing `tabs.json` or introducing session schema version 2.
- Replacing `connId`, `dbName`, `collName`, `connectionName`, or `collectionName`.
- Changing tree event or modal payloads.
- Changing Mongo query API signatures or Tauri command payloads.
- Changing menu eligibility.
- Fixing stale tabs after disconnect, drop, or rename operations.
- Migrating persisted node-tag keys.
- Modifying `connectionTarget.js`; that utility describes server endpoints, not database resources.

Persisted session migration waits until workspace types are introduced. Migrating sessions during this work would require migrating them again when the workspace envelope changes.

## Follow-Up Adoption Order

1. Migrate `menuContext.js` internals to ResourceRef.
2. Dual-carry ResourceRef in connection-tree events.
3. Normalize `useFeatures.js` action targets.
4. Add ResourceRef to newly created tabs.
5. Hydrate ResourceRef from legacy sessions.
6. Migrate Mongo query APIs to consume ResourceRef.
7. Replace path-string color and selection logic.
8. Remove old aliases only after every consumer has migrated.

## Verification

```bash
npm test -- src/utils/resourceRef.test.js
npm test -- src/utils/legacyResourceRef.test.js
npm test
npm run check:size
npm run build
```

## Acceptance Criteria

- One engine-neutral resource identity contract exists.
- The contract supports deeper future engine hierarchies without redesign.
- Every current target shape can be converted through pure functions.
- Current Operations filters are not mistaken for resource identity.
- Existing node-tag key output remains unchanged.
- No runtime behavior or persisted data changes.
- No existing production files are modified during this foundational work.
