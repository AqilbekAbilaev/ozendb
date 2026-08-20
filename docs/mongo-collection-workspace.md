**Status:** done

# Work 3: Extract The MongoDB Collection Workspace

## Goal

Move MongoDB collection query behavior and rendering out of `QueryWorkspace.vue` into an engine-owned component while keeping the existing tab model, App-facing contract, and behavior unchanged.

This is an extraction, not a redesign. Find, aggregate, and SQL-to-MQL remain modes of the current collection tab.

## Dependencies

- Work 1 must have completed the MongoDB query API boundary.
- Work 2 ResourceRef utilities should exist, but this work does not adopt ResourceRef on live tabs.
- Any in-progress Work 1 edits must be completed before this extraction starts.

## Current Responsibilities To Move

Move from `src/components/query/QueryWorkspace.vue`:

- Find, aggregate, and SQL mode detection.
- Query and pipeline parsing and validation.
- Run dispatch and SQL-to-MQL translation.
- Explain execution and storage enrichment.
- Explain verbosity handling.
- Bare ObjectId filter expansion.
- Saved-query browser state and application.
- Collection breadcrumbs.
- Query, SQL, and pipeline editors.
- Results panel rendering.
- MongoDB query API, parser, and error imports.

Keep in the temporary host:

- Active-tab lookup.
- Tab bar rendering.
- Non-collection pane dispatch.
- Existing App-facing props and emits.
- The root workspace layout.
- Compatibility state that must survive switching through another pane kind.

## Target File

Add:

```text
src/engines/mongodb/workspaces/collection/MongoCollectionWorkspace.vue
```

Update:

```text
src/components/query/QueryWorkspace.vue
```

## Component Contract

Props:

```text
activeTab
tabs
activeTabId
resultTab
vqbOpen
clipboardQuery
docMenuRequest
historyRequest
browserRequest
saveQueryRequest
```

Emits:

```text
update:result-tab
run-query
run-aggregate
toggle-vqb
open-vqb
close-vqb
copy-query
paste-query
cancel-query
follow-reference
```

Event argument ordering must remain unchanged:

```js
emit('run-query', tabId, query)
emit('run-aggregate', tabId, { pipeline })
emit('cancel-query', tabId)
```

## State Compatibility

The extracted component continues mutating existing tab fields directly:

```text
mode
filter
projection
sort
skip
limit
pipeline
sql
sqlError
explainVerbosity
explainStorage
explainResult
explainError
explainRunning
```

Do not rename fields or introduce `state`, `runtime`, `type`, `engine`, or `target` in this work.

The active result sub-tab currently lives above the collection branch. Keep a compatibility ref in `QueryWorkspace.vue` and pass it through `v-model:result-tab`. Moving it to child-local state would reset it after collection to non-collection to collection switches.

## Reviewable Change

### Change 3A: Extract And Delegate

Files: 2

1. Add `MongoCollectionWorkspace.vue`.
2. Reduce `QueryWorkspace.vue` to the tab shell and legacy pane dispatch.

This should be one atomic change because the new component has no value until the host delegates to it.

## Behavior Invariants

- Find validation and execution remain identical.
- Aggregate validation and execution remain identical.
- SQL translation still runs against the tab's selected collection.
- Explain uses aggregate plans for aggregate mode and find plans otherwise.
- Explain storage statistics remain best-effort.
- Query history, defaults, save, and load behavior remains unchanged.
- Copy/paste query and VQB events remain unchanged.
- Follow-reference behavior remains unchanged.
- Async results update the tab captured when the operation started, not a newly active tab.
- All non-collection panes render exactly as before.
- Same-kind component reuse remains unchanged.

## Out Of Scope

- Splitting find, aggregate, and SQL into separate workspace types.
- Introducing a workspace registry.
- Changing tab construction or persistence.
- Moving query execution into another composable.
- Refactoring `QueryBar.vue` or `ResultsPanel.vue`.
- Adding `KeepAlive` or component keys.
- Fixing unrelated pane lifecycle behavior.
- Completing unrelated MongoDB API modules.

## Verification

Automated:

```bash
npm test -- src/engines/mongodb/api/queries.test.js
npm test -- src/utils/queryParser.test.js
npm test
npm run check:size
npm run build
```

Manual matrix:

1. Find run, validation, paging, refresh, count, cancellation, and ObjectId shorthand.
2. Aggregate run, validation, refresh, and aggregate Explain.
3. SQL translation, translation errors, paging, and Explain.
4. Query history, defaults, save/load, copy/paste, and VQB.
5. Follow reference and document result actions.
6. Switch between two collection tabs.
7. Switch collection to non-collection to collection and verify result-tab compatibility.
8. Open every existing non-collection pane.

## Risks

- Moving result-tab state into the child changes persistence across pane switches.
- A changed emit signature silently breaks App-level handlers.
- Moving the query browser under the collection branch changes its lifetime when shortcuts switch tabs.
- Capturing `activeTab` after an `await` can write a response into the wrong tab.
- The extracted component must remain under the 600-line hard limit and should target under 400 lines.

## Acceptance Criteria

- `QueryWorkspace.vue` imports no MongoDB query APIs, parsers, query bars, results panel, collection breadcrumbs, or query browser.
- MongoDB collection behavior lives under `src/engines/mongodb/workspaces/`.
- The App-facing prop and event contract is unchanged.
- Existing tab fields and mutation behavior are unchanged.
- No store, creator, persistence, modal, or App files change.
- No dependency is added.
- Tests, size check, and production build pass.
