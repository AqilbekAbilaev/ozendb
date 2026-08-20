**Status:** done

# Work 5: Move Workspace Construction Into Definitions

## Goal

Make each workspace type own the shape and defaults of a newly created workspace. Keep `useTabCreators.js` as an orchestration layer for focus rules, asynchronous default-query loading, and initial execution.

This work removes construction knowledge from App, the tab store, and creator branches without yet moving duplicate, restore, activation, disposal, or serialization behavior.

## Dependencies

- Work 2 provides canonical ResourceRef constructors and legacy adapters.
- Work 3 provides the MongoDB collection workspace component.
- Work 4 provides the component registry and generic workspace host.
- Work 1 API extraction is complete for APIs used by creation orchestration.

## Workspace Types

```text
app.quickstart
mongodb.find
mongodb.aggregate
mongodb.sql_to_mql
mongodb.shell
mongodb.indexes
mongodb.schema
mongodb.search
mongodb.import
mongodb.export
mongodb.current_operations
```

## Definition Contract

```js
{
  type: 'mongodb.find',
  engine: 'mongodb',
  component,

  create({ target, defaults, options, ids }) {
    return {
      title,
      fields,
    }
  },
}
```

The generic factory owns common metadata:

```js
createWorkspace(type, context) => {
  id,
  type,
  engine,
  title,
  color,
  target,
  ...engineFields,
}
```

## Transitional Runtime Shape

Do not introduce a second set of duplicated live fields under `state` and `runtime` while existing components still mutate flat tab fields.

During Work 5:

- `id`, `type`, `engine`, `title`, `color`, and `target` become canonical metadata.
- Existing engine-specific editor and runtime fields remain flat for component compatibility.
- Definitions are their only construction source.
- Work 7 serializes durable fields into the versioned `state` envelope without requiring live duplicate fields.

Legacy `kind` and `mode` may remain temporarily where current components require them, but definitions own and test their values. New generic code must use `type`.

## Construction Rules

- `create()` is synchronous and pure.
- It does not mutate the workspace store.
- It does not invoke Tauri or fetch defaults.
- It receives scalar defaults rather than Vue refs.
- The factory owns workspace IDs.
- Shell session IDs use an injected ID source for deterministic tests.
- Mutable arrays, maps, and nested options are allocated fresh for every workspace.
- Definitions cannot override common envelope fields.
- Unknown workspace types fail clearly.

## Target File Structure

```text
src/workspaces/
  createWorkspace.js
  createWorkspace.test.js
  appDefinitions.js
  appDefinitions.test.js
  registerDefinitions.js

src/engines/mongodb/workspaces/
  queryDefinitions.js
  queryDefinitions.test.js
  toolDefinitions.js
  toolDefinitions.test.js
```

## Reviewable Changes

### Change 5A: Generic Factory

Files: 3

1. Add `src/workspaces/createWorkspace.js`.
2. Add `src/workspaces/createWorkspace.test.js`.
3. Extend `src/workspaces/registry.js` to expose definition lookup while preserving component lookup.

Tests:

- Unknown type fails.
- Definitions receive explicit context.
- Common fields cannot be overridden.
- IDs are generated centrally.
- Input target and options are not mutated.
- Separate creations do not share mutable fields.

### Change 5B: App Definitions

Files: 2

1. Add `src/workspaces/appDefinitions.js`.
2. Add `src/workspaces/appDefinitions.test.js`.

Add `app.quickstart` with title `Quickstart`, no resource target, and no engine-specific state.

### Change 5C: MongoDB Query Definitions

Files: 2

1. Add `src/engines/mongodb/workspaces/queryDefinitions.js`.
2. Add `src/engines/mongodb/workspaces/queryDefinitions.test.js`.

Definitions:

- Find.
- Aggregate.
- SQL-to-MQL.
- Shell.

Tests pin:

- Query-limit and result-view defaults.
- Empty find, aggregate, and SQL editor values.
- SQL title and initial text.
- Correct compatibility `kind` and `mode` fields.
- Fresh result, selection, history, logs, and column-order containers.
- Fresh shell session IDs.
- No shared nested values.

### Change 5D: MongoDB Tool Definitions

Files: 2

1. Add `src/engines/mongodb/workspaces/toolDefinitions.js`.
2. Add `src/engines/mongodb/workspaces/toolDefinitions.test.js`.

Definitions:

- Indexes.
- Schema.
- Search.
- Import.
- Export.
- Current Operations.

Tests pin:

- Target depth for each tool.
- CSV and JSON import variants.
- Export source, frozen filter, title, and mapping defaults.
- Current Operations settings and fresh runtime arrays/maps.
- Existing open/focus identity fields needed by current panes.

### Change 5E: Deterministic Registration

Files: 3

1. Add `src/workspaces/registerDefinitions.js`.
2. Update `src/workspaces/registry.test.js`.
3. Update `src/main.js` to register definitions before mounting Vue.

Requirements:

- Every expected type is registered exactly once.
- Duplicate registration fails in tests and development.
- Registration order cannot create a store/import cycle.
- Components remain statically resolvable.

### Change 5F: Delegate Existing Openers

Files: 2

1. Update `src/composables/useTabCreators.js`.
2. Add `src/composables/useTabCreators.test.js`.

Keep the public opener API unchanged.

The composable retains:

- Existing-tab lookup and focus rules.
- Asynchronous default-query loading.
- Immediate query execution rules.
- Export source resolution.
- Modal transitions.
- Store insertion and activation.

The composable no longer contains complete workspace object literals.

Tests:

- Collection, aggregate, shell, current-operations, import, and export open policies.
- SQL, index, schema, search, and Quickstart focus policies.
- Supplied filters bypass default-query loading.
- Find loads and executes its default query.
- Default-query failure executes the current empty-query fallback.
- Aggregate does not run on creation.
- SQL does not run on creation.
- Export scope is frozen at creation.
- Changed settings affect only future workspaces.

### Change 5G: Remove Remaining Fresh-Workspace Literals

Files: no more than 3

1. Update `src/stores/tabs.js` to create initial/fallback Quickstart through its definition.
2. Update `src/stores/tabs.test.js`.
3. Update `src/App.vue` only if it still constructs a fallback workspace directly.

Restore reconstruction remains in session persistence until Work 6.

## Behavior Invariants

- Existing opener function signatures remain valid.
- Existing titles remain unchanged.
- Existing open-versus-focus rules remain unchanged.
- New workspaces append and activate as before.
- Initial query timing remains unchanged.
- No additional workspace type becomes persisted.
- Existing components continue receiving the fields they currently consume.
- Every mutable value is private to one workspace.
- HMR does not reset already-open module-scope workspaces.

## Out Of Scope

- Duplicate, restore, activation, or disposal hooks.
- Session schema version 2.
- Removing all compatibility `kind` and `mode` fields.
- Moving all live fields under nested `state` and `runtime`.
- Changing pane mount behavior.
- Changing open/focus policies.
- Query behavior fixes.
- Persisting currently non-persisted workspace types.

## Verification

After every definition group:

```bash
npm test -- <definition-test-file>
npm run check:size
```

Final:

```bash
npm test
npm run check:size
npm run build
```

## Risks

- Shared arrays/maps produce cross-tab state corruption.
- Registering definitions through side effects can create import cycles.
- Passing Vue refs into definitions makes construction stateful and difficult to test.
- Changing focus rules while moving constructors mixes behavior change with refactoring.
- Introducing nested live aliases creates two writable sources of truth.

## Acceptance Criteria

- Every fresh workspace is created through a registered definition.
- `useTabCreators.js` contains orchestration but no complete tab-shape literals.
- `tabs.js` contains no hard-coded Quickstart object.
- Every mutable nested field is independently allocated.
- Generic code selects by `type` rather than MongoDB `kind`/`mode`.
- No session JSON format changes.
- Definition, creator, full test, size, and build checks pass.
