The frontend’s main problem is not Vue or the lack of Pinia. It is unclear lifecycle ownership.
A tab currently has its behavior distributed across:
- src/stores/tabs.js: generic mutations, shell cleanup, restored-query callback.
- src/composables/useTabCreators.js: constructors, default queries, export logic.
- src/composables/useSessionPersistence.js: serialization and reconstruction.
- src/composables/useQueryRunner.js: execution and runtime fields.
- src/components/query/QueryWorkspace.vue: parsing, SQL translation, explain and rendering.
- src/App.vue: event routing and dependencies.
Adding a tab means understanding all six. That is why the frontend feels brittle.
Ownership Model
A cleaner frontend should follow this division:
Layer	Responsibility
Component	Render UI and handle local interaction
Workspace controller	Execute one use case and mutate its workspace state
Engine API	Own Tauri command names and request/response mapping
Workspace definition	Create, duplicate, serialize, restore and dispose one tab type
Workspace store	Own tab collection, ordering and activation
Engine descriptor	Declare connection editor, resources, workspaces and capabilities
App	Compose the application shell only
App.vue should eventually look more like:
<ConnectionSidebar />
<WorkspaceArea />
<OperationsDock />
<AppModalHost />
<ContextMenuHost />
It should not know how to translate SQL, refresh a collection after a modal, construct import tabs or restore Mongo queries.
6. Frontend Engine Adapters
Current Problem
There are roughly 100 direct invoke() calls throughout components and composables.
For example, QueryWorkspace.vue knows:
- translate_sql
- explain_query
- explain_aggregate
- collection_stats
- Exact Mongo request field names.
- Exact Mongo response shapes.
- How SQL-to-MQL works.
- How explain plans are enriched.
That makes it simultaneously:
- A workspace renderer.
- A Mongo query controller.
- A Tauri client.
- An explain controller.
- A mode dispatcher.
A component should not know Tauri command names.
API Boundary
Start with engine-specific API modules rather than a universal database API:
src/
  api/
    tauri.js

  engines/
    mongodb/
      api/
        connections.js
        resources.js
        queries.js
        documents.js
        indexes.js
        admin.js
        shell.js
api/tauri.js should only own common transport behavior:
import { invoke } from '@tauri-apps/api/core'

export async function call(command, payload) {
  return invoke(command, payload)
}
It may eventually normalize malformed errors or provide diagnostics, but it should remain thin.
The Mongo query API owns the command contract:
// engines/mongodb/api/queries.js

import { call } from '../../../api/tauri'

export function findDocuments(target, query, runId) {
  return call('find_documents', {
    id: target.connectionId,
    database: target.database,
    collection: target.collection,
    filter: query.filter,
    projection: query.projection,
    sort: query.sort,
    skip: query.skip,
    limit: query.limit,
    comment: runId,
  })
}

export function explainFind(target, query, verbosity) {
  return call('explain_query', {
    id: target.connectionId,
    database: target.database,
    collection: target.collection,
    ...query,
    verbosity,
  })
}
The rest of the frontend no longer knows that Rust calls the connection field id, the resource fields database and collection, or the operation identifier comment.
Why Named Modules
Avoid one object containing every Mongo method:
mongodbEngine.doEverything()
That becomes another god object.
Use small cohesive modules instead:
import * as mongoQueries from './api/queries'
import * as mongoDocuments from './api/documents'
The engine descriptor should contain only metadata needed by generic application code:
export const mongodbEngine = {
  id: 'mongodb',
  label: 'MongoDB',
  connectionEditor: MongoConnectionEditor,
  resourceProvider: mongoResources,
  workspaces: mongoWorkspaces,
  actions: mongoActions,
}
Engine-specific components can import their engine-specific APIs directly. Only generic components need getEngine(engineId).
Controllers
API modules should not manage Vue state. Controllers/composables should.
For example:
MongoFindWorkspace.vue
        │
useMongoFindController(tab)
        │
mongodb/api/queries.js
        │
Tauri
useMongoFindController would own:
- Parsing.
- Loading state.
- Stale-response protection.
- Cancellation.
- History recording.
- Updating results.
- Explain execution.
This is essentially the useful logic from useQueryRunner.js and QueryWorkspace.vue, placed under one owner.
export function useMongoFindController(tab, api = mongoQueryApi) {
  async function run() {
    // parse, set runtime state, execute, reject stale response
  }

  async function cancel() {
    // cancel this workspace's active run
  }

  return { run, cancel }
}
The optional API dependency makes this unit-testable without mounting Vue or invoking Tauri.
Error Ownership
The API layer should preserve the backend’s { code, message } error contract.
The controller decides the UI consequence:
try {
  tab.runtime.result = await queries.findDocuments(...)
} catch (error) {
  tab.runtime.error = errText(error)
  tab.runtime.errorCode = errCode(error)
}
The API should not show toasts. Components should not inspect raw Tauri errors.
Engine Registry
A minimal static registry is sufficient:
import { mongodbEngine } from './mongodb'
import { postgresqlEngine } from './postgresql'

const engines = {
  mongodb: mongodbEngine,
  postgresql: postgresqlEngine,
}

export function getEngine(id) {
  const engine = engines[id]
  if (!engine) throw new Error(`Unsupported database engine: ${id}`)
  return engine
}
Do not dynamically discover plugins yet. Static imports provide stronger build-time guarantees and simpler debugging.
Actions And Modals
The current modal registry is partially successful, but registration is split between:
- modalRegistry.js
- AppModals.vue
- App.vue’s modalEmits
- App.vue’s modalProps
- useFeatures.js
That is still several sources of truth.
Engine actions should own their modal or workspace behavior:
{
  id: 'mongodb.collection.validator',
  label: 'Add / Edit Validator…',
  resourceKinds: ['mongodb.collection'],
  capabilities: ['mongodb.validator.write'],
  run({ target, modals }) {
    modals.open('mongodb.validator', { target })
  }
}
A structural modal should refresh resources through a resource store:
await mongoAdmin.createCollection(target, fields)
resources.invalidate(target.connectionId)
modals.close()
It should not emit saved through AppModals into App.vue, which then finds ConnectionTree through a template ref.
That event route is one of the largest sources of frontend indirection.
7. Tabs And Sessions
Current Problems
Tabs Are Mutable Bags
A collection tab currently mixes:
- Identity.
- Resource target.
- Editor state.
- Query state.
- Result data.
- Selection.
- Loading state.
- Explain state.
- Persistence flags.
There is no structural distinction between durable and runtime state.
kind Is Overloaded
The same kind: 'collection' represents:
- Mongo find.
- Mongo aggregation.
- SQL-to-MQL.
Behavior depends on a secondary mode field.
Future native SQL cannot fit this cleanly.
Target Names Are Inconsistent
Some tabs use:
connectionId
connectionName
collectionName
Others use:
connId
connName
collName
This creates normalization helpers such as tabNode() and causes cleanup bugs.
Lifecycle Is Scattered
duplicateTab() knows shell construction but treats every other tab as a collection tab. This can corrupt tool tabs.
closeTab() directly invokes close_shell_session.
setRunRestoredTab() injects query behavior into the store through a mutable module callback.
useSessionPersistence.js reconstructs every workspace manually through a large conditional expression.
Canonical Workspace Record
Use one envelope:
{
  id: 'uuid',
  type: 'mongodb.find',
  engine: 'mongodb',
  title: 'users',
  color: null,

  target: {
    connectionId: 'connection-id',
    segments: [
      { kind: 'database', name: 'app' },
      { kind: 'collection', name: 'users' },
    ],
  },

  state: {
    filter: '{}',
    projection: '{}',
    sort: '{}',
    skip: 0,
    limit: 50,
  },

  runtime: {
    status: 'idle',
    results: [],
    error: null,
    selectedRows: [],
  },
}
The important separation is:
- target: what database object this workspace belongs to.
- state: user work worth preserving.
- runtime: ephemeral data that must not be persisted.
Workspace types should be explicit:
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
postgresql.sql
This removes almost every kind === 'collection' && mode === ... branch.
Workspace Definitions
Each workspace type should own its lifecycle:
export const mongoFindWorkspace = {
  type: 'mongodb.find',
  engine: 'mongodb',
  component: defineAsyncComponent(
    () => import('./MongoFindWorkspace.vue')
  ),

  create({ target, defaults }) {
    return {
      title: target.segments.at(-1).name,
      target,
      state: {
        filter: '',
        projection: '',
        sort: '',
        skip: 0,
        limit: defaults.queryLimit,
      },
      runtime: emptyQueryRuntime(),
    }
  },

  serialize(tab) {
    return tab.state
  },

  restore(record) {
    return {
      ...record,
      runtime: {
        ...emptyQueryRuntime(),
        needsInitialRun: true,
      },
    }
  },

  duplicate(tab) {
    return {
      state: structuredClone(tab.state),
      runtime: emptyQueryRuntime(),
    }
  },
}
Not every definition needs every function. Provide sensible defaults and add hooks only when a workspace needs special behavior.
Shell can supply dispose():
async dispose(tab) {
  await shellApi.closeSession(tab.runtime.sessionId)
}
Mongo find can supply activate() for lazy restored-query execution.
Workspace Registry
const definitions = new Map()

export function registerWorkspace(definition) {
  if (definitions.has(definition.type)) {
    throw new Error(`Duplicate workspace type: ${definition.type}`)
  }
  definitions.set(definition.type, definition)
}

export function getWorkspaceDefinition(type) {
  const definition = definitions.get(type)
  if (!definition) throw new Error(`Unknown workspace type: ${type}`)
  return definition
}
Each engine exports its workspace definitions. The app registers them once during startup.
Workspace Store
The tab store then becomes genuinely generic:
open(type, context)
activate(id)
close(id)
duplicate(id)
move(id, beforeId)
rename(id, title)
closeWhere(predicate)
Its operations delegate type-specific behavior to the workspace definition:
function duplicate(id) {
  const source = get(id)
  const definition = getWorkspaceDefinition(source.type)
  const duplicate = definition.duplicate(source)

  add({
    ...baseTab(source.type),
    engine: source.engine,
    target: structuredClone(source.target),
    ...duplicate,
  })
}
The store should not import Tauri or Mongo APIs.
Workspace Host
QueryWorkspace.vue should become a generic WorkspaceArea.vue:
<TabBar />

<component
  v-if="activeDefinition"
  :is="activeDefinition.component"
  :tab="activeTab"
/>
The current Mongo-specific query section moves to something like:
engines/mongodb/workspaces/find/MongoFindWorkspace.vue
engines/mongodb/workspaces/aggregate/MongoAggregateWorkspace.vue
engines/mongodb/workspaces/sqlToMql/MongoSqlToMqlWorkspace.vue
They can share internal pieces:
MongoQueryLayout.vue
MongoResultsPanel.vue
useMongoQueryExecution.js
Do not make one generic query workspace that handles Mongo find, Mongo aggregation and PostgreSQL SQL through mode flags. That recreates the current problem with different names.
Versioned Sessions
The persisted format should be explicit:
{
  "schemaVersion": 2,
  "activeTabId": "uuid",
  "tabs": [
    {
      "id": "uuid",
      "type": "mongodb.find",
      "engine": "mongodb",
      "title": "users",
      "color": null,
      "target": {},
      "state": {}
    }
  ]
}
The session service handles only the envelope. Workspace definitions handle their own state.
function serializeTab(tab) {
  const definition = getWorkspaceDefinition(tab.type)

  return {
    id: tab.id,
    type: tab.type,
    engine: tab.engine,
    title: tab.title,
    color: tab.color,
    target: tab.target,
    state: definition.serialize(tab),
  }
}
Migration
Create a pure migration function:
migrateSession(rawSession)
Legacy mapping:
collection + find      → mongodb.find
collection + aggregate → mongodb.aggregate
collection + sql       → mongodb.sql_to_mql
shell                   → mongodb.shell
indexes                 → mongodb.indexes
Migration should normalize both target naming conventions into target.
It must also:
- Deduplicate IDs.
- Remove tabs for deleted connections.
- Repair invalid activeTabId.
- Reject unknown future session versions without overwriting them.
- Preserve query text exactly.
- Never persist runtime results.
This belongs in src/utils/sessionMigration.js with fixture-driven unit tests.
App State
Avoid replacing the current prop/event wiring with a giant injected appContext. That would hide dependencies rather than simplify them.
Use direct imports for stable application services:
import { useWorkspaceStore } from '../../workspace/store'
import { useSettingsStore } from '../../settings/store'
Use props and emits only for local parent-child relationships.
Use dependency parameters for testable controllers:
useMongoFindController(tab, {
  queries: mongoQueryApi,
  history: mongoHistoryApi,
  notifications,
})
Type Safety
This architecture would benefit substantially from discriminated unions. Current bugs such as duplicating a tool tab as a collection tab are exactly what TypeScript catches.
A full TypeScript conversion would be disruptive. A safer progression is:
1. Add JSDoc typedefs for WorkspaceRecord, ResourceRef and API DTOs.
2. Enable checkJs for the new architecture modules.
3. Introduce TypeScript only for new engine contracts and workspace definitions if desired.
4. Convert old Vue components opportunistically, not as a prerequisite.
Migration Sequence
 1. Introduce Mongo API modules and migrate query execution away from direct invoke().
 2. Add canonical ResourceRef and pure compatibility migration.
 3. Extract the Mongo collection UI from QueryWorkspace.vue.
 4. Introduce WorkspaceArea.vue and a component-only workspace registry.
 5. Move workspace construction into definitions.
 6. Move duplicate, restore and disposal behavior into definitions.
 7. Write session schema version 2 and migration fixtures.
 8. Remove setRunRestoredTab and backend calls from tabs.js.
 9. Move structural refresh into a resource store.
10. Remove modal event routing from App.vue.
Each should be a separate behavior-preserving change. The first concrete change I would make is the Mongo query API boundary: it is low-risk, immediately testable and begins removing Tauri/Mongo contracts from QueryWorkspace.vue and useQueryRunner.js.
