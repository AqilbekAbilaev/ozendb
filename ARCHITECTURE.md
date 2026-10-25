# Architecture

How OzenDB is put together. The rules code must follow live in [`docs/CODING.md`](docs/CODING.md);
this is the map behind them.

**Stack:** Tauri 2 (Rust backend) + Vue 3 (frontend, Vite). No router, no Pinia — plain `ref`/`computed`.

## Data flow

```
main.js  (the whole startup sequence, in order: pre-paint the theme, install the undo
          shim, register workspace definitions, seed the first tab, mount, then load
          settings → restore the session → start autosave → check for updates)
└── App.vue  (layout only: which panes exist and how wide they are. It holds no app
              state — every slice below reads its own store — and wires just three
              things: useMenu, useFeatures, useAppMenuActions)
    ├── app/Toolbar.vue                (global toolbar actions → handleTool)
    ├── app/AppRail.vue                (the vertical rail; toggles the sidebar and the ops dock)
    ├── connection/ConnectionTree.vue  (sidebar; writes the tree selection to its store)
    ├── workspace/WorkspaceArea.vue    (the tab strip and whichever workspace is active)
    ├── panes/OperationsPane.vue       (bottom dock for long-running operations)
    ├── app/AppModals.vue              (every top-level modal, incl. ConnectionManager → NewConnection)
    ├── app/AppToast.vue               (the one transient message)
    └── base/ContextMenu.vue           (routed through useFeatures' handleContextAction)
```

## The layers

Four rings, outermost first. A ring may import inwards, never outwards — **enforced by
`no-restricted-imports` in `eslint.config.js`** for every direction that currently holds.
`src/importCycles.test.js` additionally fails on any circular import.

| Layer | What lives there |
|---|---|
| `src/components/` | Rendering and event wiring only. Grouped by area: `app/`, `base/`, `connection/`, `panes/`, `query/`, `workspace/`. |
| `src/composables/` | Stateful slices that need a component's lifetime or a caller's wiring (`useFeatures`, `useMenu`, `useConnectionTree`, `useDbActions`, …). Anything that is really app-wide state belongs in `stores/` instead — most of what used to live here has moved. |
| `src/stores/` | Module-scope state shared by every importer, and the actions over it. `tabs.js` (the tab spine) · `tabCreators.js` (every "open a tab" entry point) · `queryRunner.js` · `settings.js` (also owns zoom, and loads `nodeTags.js`) · `connectionData.js` · `openConnections.js` · `connectionNavigation.js` (incl. the sidebar selection) · `modals.js` · `contextMenu.js` · `menuRequests.js` (one-shot native-menu signals) · `indexes.js` · `updater.js` · `premium.js` · `toast.js` · `dbClipboard.js` · `queryClipboard.js` · `visualQueryBuilder.js` · `nodeTags.js`. **Anything one leaf writes and another reads goes here** rather than being threaded through App.vue as props and relayed emits. |
| `src/utils/` | Pure functions. No Vue, no I/O. |

The rest of `src/` sits around those rings, with its own lint rule where a direction holds:

- **`appApi/` and `engines/*/api/`** are at the centre with `utils/`: anything may call them, and
  they reach nothing that could call them back. `appApi/` imports no app code at all; an engine's
  `api/` imports no components and no app state.
- **`workspaces/`** is the machinery `stores/tabs.js` builds on, so it reads no stores or
  composables. Its registry imports no components; each engine declares its own panes. The one
  outward edge is `appDefinitions.js` importing `QuickstartPane.vue`, which `importCycles.test.js`
  keeps from closing into a loop.
- **`components/base/`** is the UI kit: other base components, `utils/`, `constants/`, `data/` and
  `composables/`, never a store or a feature area. The one setting it honours (the editor's tab
  width) is provided by each window's root under a key in `constants/injectionKeys.js`.
- **`engines/<name>/`** is a vertical slice — components, workspaces, tree and API side by side —
  and each part follows the ring of what it is.
- **`constants/`** and **`data/`** are tables any ring may read. `constants/modalRegistry.js` names
  modal components, but only through a lazy `import()`.

## The Tauri boundary

Nothing outside two roots may call `invoke`. **This is enforced, not a convention** —
`src/appApi/apiBoundary.test.js` lists every engine-neutral command and fails the suite
if one is invoked elsewhere, or if any production file outside the roots imports
`@tauri-apps/api/core` at all.

The boundary is about `invoke` specifically, because command names and payload keys are
strings the backend adjudicates — a typo there fails silently at runtime. Event names are
the same kind of string, so `listen` / `emit` live in `src/appApi/events.js` alone (one
named function per event; the test also rejects `@tauri-apps/api/event` anywhere else,
and `src-tauri/src/events.rs` pins the backend's half). Tauri's *plugin*
APIs (`plugin-dialog`, `plugin-opener`, `plugin-updater`, `plugin-process`) are ordinary
typed calls with no wire shape, so they are imported directly wherever they are needed.

- **`src/appApi/`** — engine-neutral commands: `settings`, `session`, `menu`, `folders`,
  `tags`, `operations`, `errorLog`, `files`, `sshTrust`, `updater`, `connectionState`, `account`,
  and `events`. Nothing here knows what a collection is.
- **`src/engines/mongodb/api/`** — everything MongoDB-shaped: `queries`, `documents`,
  `admin`, `indexes`, `schema`, `resources`, `gridfs`, `shell`, `transfer`,
  `queryLibrary`. Each takes a target `{ connectionId, database, collection }` and
  turns it into a command payload via `payload.js`. **The only place that knows command
  names and wire shapes** — the rest of the frontend talks targets.

Adding a backend command means adding it to whichever root owns it, and to the list in
`apiBoundary.test.js` if it is engine-neutral.

## Workspaces (what a tab is)

A tab is a *workspace*: a plain object with a canonical envelope (`id`, `type`,
`engine`, `title`, `color`, `target`) plus whatever fields its type needs.

- **`src/workspaces/`** is the engine-neutral machinery. `registry.js` maps types to
  components; `createWorkspace.js` is the single factory and owns the envelope no
  definition may override; `lifecycle.js` dispatches duplicate / restore / dispose and
  holds the resource predicates (`affectedByResource`, `retargetResource`);
  `registerDefinitions.js` is the one explicit, ordered registration call.
- **`src/engines/mongodb/workspaces/`** holds the MongoDB definitions —
  `queryDefinitions.js` (find, aggregate, SQL, shell) and `toolDefinitions.js`
  (indexes, schema, search, import, export, current ops) — plus the collection
  workspace component itself.

**Startup order is load-bearing.** `main.js` calls `registerWorkspaceDefinitions()`,
then `initializeTabs()`, then mounts. Every static import evaluates before that body
runs, so a `createWorkspace` at module scope would hit an empty registry. Nothing may
create a workspace during module evaluation.

**Tab state** lives in `src/stores/tabs.js` — module-scope `tabs` / `activeTabId` refs
plus every mutation (activate/close/cycle/duplicate/reorder/rename), shared by every
importer. Tabs are plain objects and children mutate their properties directly (e.g.
`tab.filter`, `tab.skip`), which works because Vue 3 makes array items reactive. The tab
*creators* live in `src/stores/tabCreators.js` and the rule that the workspace never shows
an empty pane — closing the last tab seeds a Quickstart — lives in `tabs.js` with the closes
it guards. Note: module-scope refs do not survive
Vite HMR cleanly — restart the dev server before blaming the code for stale tab state.

## Engines

What differs between engines is asked of `src/engines/`, never decided by comparing engine
names — **enforced by `no-restricted-syntax` in `eslint.config.js`**, which also rejects
ad-hoc `{ mongodb: …, postgresql: … }` tables outside `src/engines/`.

- **`src/engines/index.js`** — the component-free engine table (`ENGINES`, `engineOf`):
  default port, connection-field builder, the sidebar's top-level loader, the stats card,
  whether a connection names its database, and for a SQL engine its `sql` entry. An engine
  with connection-editor fields of its own declares `useFields`: the connection form makes
  each one once, hands it to that engine's `buildFields` and editor sections, and passes it
  a pasted connection string. Stores and composables read it.
- **`src/engines/ui.js`** — the component half: connection editor sections, sidebar rows.
- **`src/engines/contextActions.js`** — right-click menus and actions an engine handles itself.
- **`src/engines/sql/`** — the table and SQL tabs every SQL engine shares. What differs comes
  from the tab's engine as `engineOf(tab).sql`: its `dialect` (quoting, case-insensitive
  matching, column-type kinds, which columns take a value), its `api` (the commands the tabs
  call, and `saveRows`, which saves a table tab's staged rows in one transaction), `readPlan` for its Explain output, and the names of its own export and row-history
  windows. A run carries its engine's name, so `runSql` finds the same commands. Each engine
  registers the table tab through `tableDefinition.js`.
  `connection/` holds what their connection editors share: the authentication and SSL sections and the payload builder.
  `api/library.js` is the query library's half of the Tauri boundary, the same for every SQL engine.

A new engine is a folder plus an entry in each. What's left is debt, not pattern: MongoDB's
screens still sit in the shared `components/` folders, and `utils/menuContext.js` mirrors
`menu.rs`'s per-engine menus.

## Resource identity

A connection/database/collection is named by a **ResourceRef** — `{ connectionId,
segments: [{ kind, name }] }` — in `src/utils/resourceRef.js`. Ordered segments rather
than fixed Mongo fields, so a deeper hierarchy (PostgreSQL `database/schema/table`)
fits without a redesign. Names are opaque and never parsed by `/` or `.`; display names
are presentation, not identity.

Every workspace carries one as `target`, and containment questions are asked of it —
"does dropping this close that tab?" is `affectedByResource`, not string comparison.

Everything between the sidebar and menus and the code that opens a tab or a modal passes
`{ resource, connectionName }`: the ref, plus the display name a ref never carries.
`apiTarget` in `src/engines/mongodb/api/payload.js` is the one place a ref becomes the
MongoDB API's `{ connectionId, database, collection }`. Every tab names its resource by
`target` alone and keeps only the connection's display name beside it (#303), so a
rename moves the target and nothing else; Current Operations' `dbName`/`collName` are
filters, not identity. Panes read names off the target with `segmentName` /
`resourceName`. The PostgreSQL openers still take flat `{ connectionId, database,
schema, table }` fields, which their definitions turn into the ref. New code takes a
ResourceRef.

## PostgreSQL (preview)

The second engine runs on the same machinery as MongoDB rather than beside it: the same tab store,
workspace registry, menu gates and Tauri boundary. Its resources are `database/schema/table`
ResourceRefs.

- **Frontend: `src/engines/postgresql/`.**
  - `connection/` holds the connection fields and URI parsing.
  - `tree/` holds the sidebar's database → schema → table nodes and their menus.
  - `sql.js` is its `sql` entry for the shared SQL tabs in `src/engines/sql/`.
  - `workspaces/` holds the search workspace and the definitions: `postgresDefinitions.js`
    registers the shared table and query screens and its own search as
    `postgresql.table_browse`, `postgresql.query` and `postgresql.search`.
  - `admin/` holds the server-info, activity, roles, grants, routines, DDL, import/export and
    row-history modals.
  - `api/` is its half of the Tauri boundary.
- **Backend: `src-tauri/src/commands/postgres/`**, one file per area, over `sqlx`.
  - Commands resolve a pool through `ctx.pg_pool*`.
  - Three modules sit in `src-tauri/src/postgres/`: `uri.rs` (connect options), and the
    `query_library.rs` (saved SQL and run history, which every SQL engine keeps there) and `row_history.rs` (per-row undo)
    stores.
- **Tests:** the `live_tests/pg*.rs` files run against a live server when
  `OZENDB_TEST_POSTGRES` is set, and are skipped otherwise.

## MySQL (preview)

The third engine, following PostgreSQL's layout. Its resources are `database/table` ResourceRefs (and `database/view`, `database/procedure` and the like for stored programs):
MySQL has no schema level, and one connection reaches every database on its server.

- **Frontend: `src/engines/mysql/`.** `connection/` holds the URI parsing, `tree/` the sidebar's
  database → table → columns rows, then a folder each for the database's views, procedures,
  functions, triggers and events, and their menus, `admin/` the modal showing a view's or stored
  program's definition, `sql.js` its `sql` entry for the shared table
  and SQL tabs (with `filterValues.js`, how SQL mode writes a filter's value), `workspaces/` their
  definitions (`mysql.table_browse`, `mysql.query`), and `api/` its half of the Tauri boundary.
  The shared tab qualifies a table by its `schema`; on MySQL that is the database.
- **Backend: `src-tauri/src/commands/mysql/`**, resolving a pool through `ctx.mysql_pool` (or
  `ctx.mysql_pool_for_write` to change data), and the `src-tauri/src/mysql/` modules described
  below. `browse.rs` reads the table tab's page and count, joins included (each table aliased `t0`, `t1`…, and a filter on a joined column read by that table's own column types); `schema.rs` lists the catalog and the foreign keys join offers come from; `routines.rs` the stored programs, and the SHOW CREATE statement of any of them or a view; `cell.rs` turns each cell into the
  grid's JSON by its column type, since MySQL can't wrap a row as JSON server-side the way
  PostgreSQL does; `row_write.rs` saves the tab's staged rows, writing each value back from what
  the grid shows, in one transaction inside one command rather than one held open between calls.
  The SQL tab's runs are `query.rs`: `script.rs` splits a script into its statements (MySQL
  prepares one at a time) and refuses typed transaction control and, on a read-only connection,
  SQL that would lift the session's read-only mode, prepared statements, and CALL, since a
  procedure can lift it and write whatever it declares; a CALL answers with each result set; each run gets a session of its own, closed
  afterwards so nothing it set reaches the next. `cancel.rs` stops a run with `KILL QUERY` from a
  second session, on Cancel or past the time limit, which MySQL itself applies to SELECTs only;
  `transaction.rs` holds Manual mode's transactions, each on its own session. `explain.rs` is
  Explain: one statement's plan, with ANALYZE's real rows and times for a SELECT, run in a
  read-only transaction that is rolled back. It picks the form by server version: `EXPLAIN
  FORMAT=JSON` in its second version on MySQL 8.3 and later; ANALYZE's text tree for a SELECT on
  8.0.18 to 8.2; the classic JSON, not run, for anything else before 8.3. `workspaces/planRows.js`
  reads all three into the shared plan view, through `classicPlan.js` and `treePlan.js`.
- **Tests:** the `live_tests/mysql*.rs` files run when `OZENDB_TEST_MYSQL` is set.

## Rust backend (`src-tauri/src/`)

| File | Responsibility |
|---|---|
| `commands/` | All `#[tauri::command]` functions, split by area (`query`, `admin`, `connection`, `schema`, `sql`, `gridfs`, `stats`, `search`, `profiler`, `duplicate`, `copyops`, `users`, `mapreduce`, …) and re-exported from `commands/mod.rs`. `mod.rs` also holds `AppContext` — the pool + storage bundle every connection-touching command takes as its single `State`, whose `client` / `client_for_write` / `collection` / `collection_for_write` methods (and `pg_pool` / `pg_pool_for_write` for PostgreSQL, `mysql_pool` / `mysql_pool_for_write` for MySQL) are the one place a connection resolves to a live client — plus the EJSON/CSV parse helpers. PostgreSQL's commands live under `commands/postgres/`, MySQL's under `commands/mysql/`. |
| `pool.rs` | `ConnectionPool`: one `Client` per MongoDB connection id, or one `PgPool` per PostgreSQL `(connection, database)` — Postgres has no per-query `USE` — or one `MySqlPool` per MySQL `(connection, database)`, behind a `tokio::Mutex` (and the live `SshTunnel` for tunnelled connections). `connect()` returns the cached client on a hit and only reads the keychain / builds the URI on a miss. |
| `storage/mod.rs` | JSON persistence for `ConnectionConfig` (`connections.json`). Read-modify-write goes through the locked `update_with`; the raw `save` is private so writes can't bypass the lock. Most other JSON stores (`folders`, `history`, `saved_queries`, `default_queries`, `settings`, `shell_history`, `known_hosts`, `node_tags`, `collection_history`, `keybindings`, `export_watermarks`, `operations`) share the same shape via the generic `JsonStore<T>` in `json_store.rs`. `tabs.rs` and `storage/mod.rs` are deliberately bespoke — each carries a comment saying why. |
| `persist.rs` | `atomic_write()` — write-to-temp-then-rename so a crash can't leave a truncated file. Shared by every JSON store. |
| `keychain.rs` | Secrets (passwords, SSH key passphrases) in the OS keychain, keyed by connection id (SSH secrets under `id::ssh-*`). Configs on disk are credential-free. |
| `ssh.rs` / `known_hosts/mod.rs` | Optional SSH tunnel (pure-Rust `russh`) with trust-on-first-use host-key verification: unchanged key accepted, new host prompts, changed key refused. |
| `shell/` | Embedded JS shell ("IntelliShell"): `engine.rs` runs one `boa` context per session on its own worker thread; `bridge/mod.rs` exposes the `db` object that forwards to the driver. |
| `uri/mod.rs` | `build_uri()` assembles the connection string from a config; `with_timeout()` appends MongoDB timeout params; `tcp_probe()` does a fast TCP check before the MongoDB handshake. |
| `error.rs` | `AppError` enum serialized as `{ code, message }` so the frontend gets a stable category plus a human-readable message. |
| `menu.rs` | Native OS menu (source of truth). Also opens the document editor/viewer as a **second Tauri webview window** at `src/pages/document.html` (registered as a Vite entry in `vite.config.js`). See "Native menu" below. |
| `commands/mongo/`, `commands/postgres/`, `commands/mysql/` | Each engine's commands. The rest of `commands/` is engine-neutral: connections, persistence, folders, operations, the error log, the updater, and the CSV import/export helpers both engines' transfers use. `commands/access.rs` is the one lookup and read-only gate behind every `AppContext` resolver. |
| `commands/sql/` | What every SQL engine's commands share without talking to a server: the filter, join and result shapes, the row cap, and reading SQL with `sqlparser` (format, read back into filters, refuse typed transaction control) in the dialect the engine passes in. And `library.rs`, the commands over every SQL engine's saved SQL and run history. |
| `postgres/` | PostgreSQL outside the command layer: `uri.rs` (connect options) and the `query_library` / `row_history` stores. |
| `mysql/` | MySQL outside the command layer: `uri.rs` (the connect options the pool and Test Connection dial with, and the Copy URI string) and `session.rs` (the time limit, the UTC time zone (cells show a TIMESTAMP in the user's own zone), and for a read-only connection the server-side read-only mode, that every new session sets, since sqlx's MySQL options carry no session variables). |
| `live_tests/` | Tests against a live server, skipped unless `OZENDB_TEST_MONGODB` / `OZENDB_TEST_POSTGRES` / `OZENDB_TEST_MYSQL` is set. `cargo test live_tests::pg` runs just the PostgreSQL ones. |

## Native menu

The app menu is the **native OS menu**, built entirely in `src-tauri/src/menu.rs` (macOS
system menu bar with the standard application menu + ⌘ accelerators; native in-window menu on
Windows/Linux). There is no in-window Vue menu bar — the old `src/components/Menubar.vue` was
removed.

- **Structure** is a data table (`menus()`): each item has an id, label, optional accelerator, and
  an optional `Gate` naming what must be resolvable for it to enable (`Connection`, `Collection`,
  `Document`, `Index`, `PgTable`, … — the `Gate` enum lists them). Placeholders are
  the `built:false` features — carried over as present-but-disabled items.
- **Engine scope**: an item whose gate belongs to one engine is hidden while the selection is
  another engine's (`menus_for`). It is read off the gate rather than tagged per item, so what is
  hidden is exactly what could never enable there.
- **Clicks** → `handle_event` emits `menu-action` with the item id → `App.vue` listens and routes
  through the existing `handleMenuAction` (same handlers the toolbar/right-click use). Actions are
  never reimplemented in Rust.
- **Enable/disable** reflects the current selection, which is the UNION of the active tab **and the
  sidebar/tree selection** (`treeSelection` in `stores/connectionNavigation.js`, which the tree
  writes). `useMenu` derives the `menuContext` (see `src/utils/menuContext.js`, unit-tested) from
  those and the open connections, and pushes it to Rust via the
  `set_menu_context` command, which flips each gated item's `enabled`. Menu actions resolve their
  target via `resolveMenuTarget`, which is level-aware: it picks whichever of the sidebar selection
  or active tab actually satisfies the action's required depth (`connection`/`database`/`collection`),
  with the sidebar selection winning when both qualify and the active tab used as fallback when the
  selection is too shallow — so an enabled item always fires on a node deep enough for the gate that
  lit it up.
- **Accelerators** are attached on macOS/Windows only. On Linux they're omitted (WebKitGTK swallows
  editing keys) and `useAppMenuActions` keeps the JS shortcuts instead, matched against the
  user's bindings.
- The gate→enabled derivation is unit-tested in `menu.rs` (`cargo test`) and `menuContext.test.js`
  (`npm test`).
