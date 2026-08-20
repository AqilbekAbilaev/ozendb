**Status:** done

# Work 1: Complete MongoDB Frontend API Boundary

## Goal

Move every MongoDB-specific Tauri invocation behind modules in:

```text
src/engines/mongodb/api/
```

Current scope:

- 95 MongoDB-specific commands.
- 138 direct call sites.
- 53 frontend consumer files.

Engine-neutral application commands remain direct Tauri calls.

## Boundary Rule

After completion:

- Components, composables, and stores contain no MongoDB command names.
- Only `src/engines/mongodb/api/*.js` calls MongoDB-specific Tauri commands.
- API modules own command names and wire payload translation.
- API modules contain no Vue state, toasts, or UI error handling.
- Existing behavior and error handling remain unchanged.

## Mongo API Modules

| Module | Responsibility |
|---|---|
| `payload.js` | Shared connection/database/collection payload translation |
| `connections.js` | Mongo connection testing, persistence, URI, and disconnect |
| `resources.js` | Database, collection, and view discovery/lifecycle |
| `queries.js` | Find, aggregate, count, cancel, explain, search, SQL translation, and map-reduce |
| `queryLibrary.js` | Defaults, history, and saved queries |
| `documents.js` | Document CRUD, bulk mutations, history, and document window |
| `indexes.js` | Index listing, creation, deletion, visibility, and statistics |
| `admin.js` | Server statistics, operations, profiler, validators, users, roles, and functions |
| `transfer.js` | Import, export, collection copy, and duplication |
| `gridfs.js` | GridFS buckets and files |
| `shell.js` | Mongo shell sessions and history |
| `schema.js` | Schema analysis and export |

Every module receives a colocated contract test.

## API Conventions

Frontend-facing collection target:

```js
{
  connectionId,
  database,
  collection,
}
```

Shared payload helpers:

```js
connectionPayload(connectionId, extra)
databasePayload(target, extra)
collectionPayload(target, extra)
```

Wrappers accept semantic arguments rather than raw backend payloads:

```js
createCollection(target, options)
countDocuments(target, filter)
replaceDocument(target, filter, replacement)
```

Avoid generic wrappers such as:

```js
runMongoCommand(command, payload)
```

Errors pass through unchanged. Responses pass through unless normalization provides a meaningful frontend contract.

## Phase 0: Shared Payload Helpers

Files:

```text
Add    src/engines/mongodb/api/payload.js
Add    src/engines/mongodb/api/payload.test.js
Update src/engines/mongodb/api/queries.js
```

Work:

1. Add connection, database, and collection payload helpers.
2. Test exact key translation from `connectionId` to backend `id`.
3. Preserve extra payload fields.
4. Refactor the existing query API to use the helpers.
5. Do not introduce `ResourceRef` yet.

## Phase 1: Finish Query APIs

### Query Execution

Extend `queries.js` with:

```text
count_documents
search_collections
map_reduce
```

Migrate callers in batches of no more than three files:

```text
ResultsPanel.vue
DeleteDocumentsModal.vue
UpdateDocumentsModal.vue

SearchPane.vue
MapReduceModal.vue

ExportPane.vue
DocumentEditorPage.vue
useGridCellActions.js
```

The latter files may be fully migrated during their document or transfer phase to avoid touching them twice.

### Query Library

Add:

```text
src/engines/mongodb/api/queryLibrary.js
src/engines/mongodb/api/queryLibrary.test.js
```

Move:

```text
get_default_query
set_default_query
clear_default_query
list_saved_queries
save_query
delete_saved_query
get_query_history
push_query_history
clear_query_history
```

Migrate:

```text
QueryBar.vue
QueryBrowserModal.vue
useTabCreators.js
useQueryRunner.js
```

After all consumers move, remove `recordHistory()` from `queries.js`.

## Phase 2: Connections And Resources

### Connections API

Add and test wrappers for:

```text
test_connection
test_ssh_connection
save_connection
update_connection
list_connections
delete_connection
disconnect
connection_uri
duplicate_connection
export_connections
import_connections
```

Migrate in small batches:

```text
useConnectionForm.js

ConnectionManager.vue
QuickstartPane.vue
UsersModal.vue

useConnectionTree.js
useNodeTags.js
useSessionPersistence.js

useConnectionFolders.js
useFeatures.js
```

These files may retain direct engine-neutral calls such as `set_connection_open`, folder commands, tags, and session persistence.

### Resources API

Add and test wrappers for:

```text
list_databases
create_collection
create_database
create_view
drop_database
drop_collection
rename_collection
```

Migrate structural dialogs:

```text
AddCollectionModal.vue
AddBucketModal.vue
AddDatabaseModal.vue
AddViewModal.vue
DropDatabaseModal.vue
DropCollectionModal.vue
RenameCollectionModal.vue
```

Migrate discovery callers:

```text
useConnectionTree.js
ShellConsole.vue
CurrentOpsPane.vue
SearchPane.vue
useDbActions.js
useDbTransfer.js
```

## Phase 3: Documents And Indexes

### Documents API

Add and test wrappers for:

```text
insert_document
insert_documents
replace_document
delete_document
update_many
delete_many
clear_collection
list_collection_history
clear_collection_history
restore_history
open_document_window
```

Migrate:

```text
useDocumentActions.js
useGridCellActions.js
DocumentEditorPage.vue
UpdateDocumentsModal.vue
DeleteDocumentsModal.vue
CollectionHistoryModal.vue
```

Any `find_documents` or `count_documents` calls in these files use `queries.js`.

### Indexes API

Add and test wrappers for:

```text
list_indexes
create_index
drop_index
set_index_hidden
index_stats
```

Migrate:

```text
useIndexes.js
IndexManagerPane.vue
```

Collection statistics use `admin.js`, not `indexes.js`.

## Phase 4: Administration And Schema

### Admin API

Add and test wrappers for:

```text
collection_stats
database_stats
server_status
server_info
current_ops
kill_op
get_profiling_status
set_profiling_level
list_profile
get_validator
set_validator
list_users
create_user
drop_user
copy_users_to_connection
list_roles
list_functions
save_function
drop_function
```

Migrate in batches:

```text
StatsModal.vue
DatabaseStatsModal.vue
ServerStatusModal.vue

ServerChartsModal.vue
ServerInfoModal.vue
useStatsTip.js

useCurrentOps.js
ProfilerModal.vue
ValidatorModal.vue

UsersModal.vue
RolesModal.vue
FunctionsModal.vue

useIndexes.js
IndexManagerPane.vue
queries.js
```

`queries.loadExplainStorage()` should call the admin API's collection-statistics wrapper rather than invoking `collection_stats` itself.

### Schema API

Add and test wrappers for:

```text
analyze_schema
export_schema
```

Migrate:

```text
SchemaPane.vue
```

## Phase 5: Transfer, GridFS, And Shell

### Transfer API

Add and test wrappers for:

```text
export_collection
import_collection
import_collection_mapped
export_collection_fields
import_preview
duplicate_collection
copy_collection
copy_collection_to_connection
```

Migrate:

```text
useDbTransfer.js
useDbActions.js
ExportPane.vue
ImportPane.vue
CsvImportPane.vue
DuplicateCollectionModal.vue
```

`stage_import_text` remains direct because it is generic file staging.

### GridFS API

Add and test wrappers for:

```text
list_gridfs_buckets
list_gridfs_files
gridfs_upload
gridfs_download
gridfs_delete
gridfs_rename
gridfs_set_metadata
gridfs_drop_bucket
gridfs_copy_bucket
```

Migrate:

```text
GridFsModal.vue
```

### Shell API

Add and test wrappers for:

```text
run_shell_command
close_shell_session
get_shell_history
push_shell_command
clear_shell_history
```

Migrate:

```text
ShellConsole.vue
stores/tabs.js
```

`read_shell_script` and `write_shell_script` remain direct because they are generic file I/O.

## Engine-Neutral Commands

These remain outside the Mongo API boundary:

```text
get_settings
update_settings
get_keybindings
update_keybindings
get_open_tabs
set_open_tabs
set_menu_context
list_operations
clear_operations
list_folders
create_folder
rename_folder
delete_folder
move_connection_to_folder
get_node_tags
set_node_tag
clear_node_tags_under
set_connection_tag
set_connection_open
update_last_accessed
respond_ssh_host_key
forget_ssh_host
stage_import_text
read_shell_script
write_shell_script
can_self_update
list_error_log
clear_error_log
error_report_context
record_frontend_error
```

A file may therefore still import `invoke`, but it must not invoke a MongoDB-specific command directly.

## Test Strategy

Each API test mocks `@tauri-apps/api/core` and verifies:

- Exact command name.
- Exact backend payload.
- `connectionId` to `id` translation.
- Response pass-through.
- Error pass-through.
- Intentional response normalization.

Existing consumer tests may continue mocking Tauri transitively during extraction. Test-only cleanup should not be bundled with the boundary migration.

## Boundary Guard

Add:

```text
src/engines/mongodb/api/apiBoundary.test.js
```

The test scans frontend source files and fails when any known MongoDB command is invoked outside `src/engines/mongodb/api/`.

This protects the architecture because the repository has no linter.

## Execution Rules

- Test first for each API module.
- Maximum three touched files per reviewable change.
- Confirm between domain batches.
- Do not alter tab shapes or persisted sessions.
- Do not introduce `ResourceRef`; that remains Work 2.
- Do not change Rust command names or payloads.
- Do not combine behavior fixes with this refactor.
- Leave unrelated agent changes untouched.

## Verification

After each batch:

```bash
npm test -- src/engines/mongodb/api/<module>.test.js
npm run check:size
```

After the complete migration:

```bash
npm test
npm run check:size
npm run build
```

Final search:

```bash
rg -n "invoke\\('(MONGO_COMMANDS...)'" src \
  --glob '*.js' \
  --glob '*.vue' \
  --glob '!src/engines/mongodb/api/**'
```

Expected result: no MongoDB-specific direct invocations outside the API directory.

## Acceptance Criteria

- All 95 MongoDB-specific commands are represented by engine API functions.
- All 138 MongoDB-specific call sites route through those APIs.
- No component, composable, or store contains a MongoDB command name.
- Engine-neutral Tauri calls remain direct.
- Every API module has wire-contract tests.
- Existing behavior, errors, toasts, and response handling remain unchanged.
- The complete test suite, size check, and production build pass.
- An automated boundary guard prevents future regressions.
