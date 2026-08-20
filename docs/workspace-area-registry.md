**Status:** done

# Work 4: WorkspaceArea And Component Registry

## Goal

Replace the hard-coded pane-selection chain with a generic workspace host and a static component-only registry.

This work changes component selection, not workspace construction, lifecycle, or persistence.

## Dependencies

- Work 3 must provide `MongoCollectionWorkspace.vue`.
- Work 2 must define ResourceRef, but current legacy tab fields remain authoritative here.
- Work 1 should be complete so registered panes are not simultaneously changing transport boundaries.

## Target Files

Add:

```text
src/workspaces/registry.js
src/workspaces/registry.test.js
src/components/workspace/WorkspaceArea.vue
```

Update:

```text
src/App.vue
```

Delete after App switches:

```text
src/components/query/QueryWorkspace.vue
```

## Component Registry

The registry maps current compatibility keys to stable component definitions:

```js
export const WORKSPACE_COMPONENTS = Object.freeze({
  quickstart: QuickstartPane,
  collection: MongoCollectionWorkspace,
  shell: ShellConsole,
  indexes: IndexManagerPane,
  schema: SchemaPane,
  search: SearchPane,
  currentOps: CurrentOpsPane,
  export: ExportPane,
  import: ImportPane,
  'import:csv': CsvImportPane,
})

export function workspaceComponentFor(tab) {
  // Compatibility resolution only.
}
```

Resolution rules:

- Missing active tab resolves to Quickstart.
- `kind: quickstart` resolves to Quickstart.
- All collection modes resolve to `MongoCollectionWorkspace`.
- CSV import resolves to `import:csv`.
- Other import formats resolve to `import`.
- Other known kinds resolve directly.
- Unknown non-null kinds resolve to `null`, preserving the current blank-pane behavior.

The registry must be static. Do not introduce runtime plugin discovery.

## Component-Only Boundary

Registry entries must not contain:

```text
create
duplicate
serialize
restore
activate
dispose
defaults
capabilities
resource requirements
```

Those belong to Works 5 and 6.

Only the shell keeps its current async loading behavior. Declare the async wrapper once at module scope so repeated resolution returns the same component identity.

## WorkspaceArea Responsibilities

`WorkspaceArea.vue` owns:

- Active-tab lookup.
- Tab bar rendering.
- Component resolution.
- Generic dynamic component rendering.
- Tab-strip event forwarding.
- Existing collection compatibility props and listeners.
- Result-sub-tab compatibility state from Work 3.
- The root `.work` layout.

It preserves the current App-facing contract so `App.vue` only changes the component import and tag.

Do not add `:key="activeTab.id"` in this work. The existing `v-else-if` chain reuses same-kind component instances, and several panes depend on their current mount/watch behavior. Explicit remount semantics require a separate lifecycle decision.

Do not add `KeepAlive`.

## Reviewable Changes

### Change 4A: Registry And Resolver Tests

Files: 2

1. Add `src/workspaces/registry.js`.
2. Add `src/workspaces/registry.test.js`.

Tests:

- Every current tab kind.
- All collection modes use the same component.
- CSV and non-CSV import differ.
- Missing active tab falls back to Quickstart.
- Unknown kind returns `null`.
- Repeated resolution returns stable component identity.
- Shell remains async and stable.

### Change 4B: Add The Generic Host

Files: 1

1. Add `src/components/workspace/WorkspaceArea.vue`.

The old host remains active until the next checkpoint.

### Change 4C: Switch App And Retire The Old Host

Files: 2

1. Update `src/App.vue` to render `WorkspaceArea` with unchanged bindings.
2. Delete `src/components/query/QueryWorkspace.vue`.

`App.vue` is at the file-size limit, so this change must be line-neutral or shrink it.

## Prop Forwarding

Do not blindly forward every collection-only prop and listener to every pane. Dynamic components can pass undeclared attributes into pane root DOM nodes.

Build bindings according to the resolved compatibility key:

- Ordinary panes receive `activeTab`.
- Quickstart receives no tab prop.
- Mongo collection workspace receives its full compatibility contract.

## Behavior Invariants

- Tab activation, close, reorder, and context-menu events are unchanged.
- Quickstart fallback remains unchanged.
- Every existing pane resolves from the same legacy fields.
- Shell remains lazy-loaded.
- Switching between same-kind tabs retains current component reuse.
- Switching between different pane kinds unmounts the prior pane as before.
- CSV and JSON import continue using different pane components.
- Collection request signals still reach the active Mongo collection workspace.

## Out Of Scope

- Explicit workspace `type` values.
- Engine IDs on tabs.
- Workspace construction definitions.
- Duplicate, restore, activation, or disposal hooks.
- Session schema changes.
- ResourceRef adoption on live tabs.
- Making all panes async.
- Pane rewrites or state relocation.
- Plugin discovery.

## Verification

After registry work:

```bash
npm test -- src/workspaces/registry.test.js
npm run check:size
```

After switching App:

```bash
npm test
npm run check:size
npm run build
```

Manual checks:

1. Open every pane kind.
2. Switch between two tabs of the same kind.
3. Switch between different kinds.
4. Verify CSV and JSON import routing.
5. Verify shell loads only when first opened.
6. Verify collection props, commands, and request signals.
7. Verify unknown-tab behavior in a controlled development fixture.

## Risks

- Creating async wrappers inside the resolver causes remounts.
- Adding a component key changes pane lifecycle.
- Generic attribute forwarding can leak listeners and props to DOM roots.
- Falling back unknown kinds to Quickstart can hide corrupted sessions.
- Adding lifecycle metadata now would merge Work 4 with Works 5 and 6.

## Acceptance Criteria

- `App.vue` renders `WorkspaceArea.vue`.
- `QueryWorkspace.vue` no longer exists.
- One static registry is the source of workspace component selection.
- Registry entries contain components only.
- Every current compatibility case is covered by tests.
- No tab, target, or session shape changes.
- Same-kind reuse and shell lazy loading remain unchanged.
- Tests, size check, and production build pass.
