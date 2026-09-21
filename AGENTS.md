# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

1. Ask, don't assume. If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements. When running unattended, pick the most reasonable interpretation, proceed, and record the assumption rather than blocking.

2. Implement the simplest solution for simple problems, better solutions for harder problems. Do not over-engineer or add flexibility that isn't needed yet. 

3. Don't touch unrelated code but please do surface bad code or design smells you discover with me so we can address them as a separate issue.

4. Flag uncertainty explicitly. If you're unsure about something, see point 1 above. If it makes sense to do so, conduct a small, localised and low-risk experiment and bring the hypothesis and results to me to discuss. Confidence without certainty causes more damage than admitting a gap.

5. I'm always open to ideas on better ways to do things. Please don't hesitate to suggest a better way, or one that has long lasting impact over a tactical change. (as a few examples)

# OzenDB — Claude Guidelines
## Commands

```bash
# Run the full app (Vite dev server + Tauri shell)
npm run tauri dev

# Verify any backend change: compiles the test tree too, which `cargo build` does not
cd src-tauri && cargo test

# Frontend-only Vite dev server (no Tauri; invoke() calls won't work)
npm run dev

# Run frontend unit tests (Vitest; specs live next to sources, e.g. src/utils/*.test.js)
npm test

# Unused-code lint (eslint + eslint-plugin-vue); not yet a CI gate
npm run lint
```

---

## Architecture

**Stack:** Tauri 2 (Rust backend) + Vue 3 (frontend, Vite). No router, no Pinia — plain `ref`/`computed`.

### Data flow

```
main.js  (pre-paints the theme, installs the undo shim, registers workspace definitions, seeds the first tab, mounts, then starts the silent update check — in that order)
└── App.vue  (composition root: wires the composables, owns split-pane sizing)
    ├── app/Toolbar.vue                (global toolbar actions → handleTool)
    ├── connection/ConnectionTree.vue  (sidebar; emits select-node / select-collection)
    ├── workspace/WorkspaceArea.vue    (the tab strip and whichever workspace is active)
    ├── panes/OperationsPane.vue       (bottom dock for long-running operations)
    ├── app/AppModals.vue              (every top-level modal, incl. ConnectionManager → NewConnection)
    └── base/ContextMenu.vue           (routed through useFeatures' handleContextAction)
```

### The layers

Four rings, outermost first. A ring may import inwards, never outwards.

| Layer | What lives there |
|---|---|
| `src/components/` | Rendering and event wiring only. Grouped by area: `admin/`, `app/`, `base/`, `connection/`, `panes/`, `query/`, `results/`, `tools/`, `workspace/`. |
| `src/composables/` | Stateful, reusable slices (`useModals`, `useQueryRunner`, `useFeatures`, `useMenu`, …). One composable owns one slice end to end. |
| `src/stores/` | Module-scope state shared by every importer: `tabs.js` (the tab spine), `connectionData.js` (databases per connection), `openConnections.js`, `connectionNavigation.js`, `settings.js` (also owns zoom and loads `nodeTags.js`), `modals.js`, `toast.js`, `updater.js`, `queryClipboard.js`, `visualQueryBuilder.js`. Anything one leaf writes and another reads goes here rather than being threaded through App.vue as props and relayed emits. |
| `src/utils/` | Pure functions. No Vue, no I/O. |

### The Tauri boundary

Nothing outside two roots may call `invoke`. **This is enforced, not a convention** —
`src/appApi/apiBoundary.test.js` lists every engine-neutral command and fails the suite
if one is invoked elsewhere, or if any production file outside the roots imports
`@tauri-apps/api/core` at all.

- **`src/appApi/`** — engine-neutral commands: `settings`, `session`, `menu`, `folders`,
  `tags`, `operations`, `errorLog`, `files`, `sshTrust`, `updater`, `connectionState`.
  Nothing here knows what a collection is.
- **`src/engines/mongodb/api/`** — everything MongoDB-shaped: `queries`, `documents`,
  `admin`, `indexes`, `schema`, `resources`, `gridfs`, `shell`, `transfer`,
  `connections`, `queryLibrary`. Each takes a target `{ connectionId, database,
  collection }` and turns it into a command payload via `payload.js`. **The only place
  that knows command names and wire shapes** — the rest of the frontend talks targets.

Adding a backend command means adding it to whichever root owns it, and to the list in
`apiBoundary.test.js` if it is engine-neutral.

### Workspaces (what a tab is)

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
*creators* live in `src/composables/useTabCreators.js`, which App.vue constructs with
the query runner and settings-backed defaults. Note: module-scope refs do not survive
Vite HMR cleanly — restart the dev server before blaming the code for stale tab state.

### Resource identity

A connection/database/collection is named by a **ResourceRef** — `{ connectionId,
segments: [{ kind, name }] }` — in `src/utils/resourceRef.js`. Ordered segments rather
than fixed Mongo fields, so a deeper hierarchy (PostgreSQL `database/schema/table`)
fits without a redesign. Names are opaque and never parsed by `/` or `.`; display names
are presentation, not identity.

Every workspace carries one as `target`, and containment questions are asked of it —
"does dropping this close that tab?" is `affectedByResource`, not string comparison.

`src/utils/legacyResourceRef.js` converts in both directions between a ResourceRef and
the older flat shapes. **Those flat shapes are still live** — `{ connId, connName,
dbName, collName }` in tool tabs and modal props, `{ connectionId, connectionName,
dbName, collectionName }` in collection and shell tabs — and retiring them is unfinished
work, not a pattern to copy. New code takes a ResourceRef.

### Rust backend (`src-tauri/src/`)

| File | Responsibility |
|---|---|
| `commands/` | All `#[tauri::command]` functions, split by area (`query`, `admin`, `connection`, `schema`, `sql`, `gridfs`, `stats`, `search`, `profiler`, `duplicate`, `copyops`, `users`, `mapreduce`, …) and re-exported from `commands/mod.rs`. `mod.rs` also holds `AppContext` — the pool + storage bundle every connection-touching command takes as its single `State`, whose `client` / `client_for_write` / `collection` / `collection_for_write` methods are the one place a connection resolves to a live client — plus the EJSON/CSV parse helpers. |
| `pool.rs` | `ConnectionPool`: one `Client` per connection id behind a `tokio::Mutex` (and the live `SshTunnel` for tunnelled connections). `connect()` returns the cached client on a hit and only reads the keychain / builds the URI on a miss. |
| `storage/mod.rs` | JSON persistence for `ConnectionConfig` (`connections.json`). Read-modify-write goes through the locked `update_with`; the raw `save` is private so writes can't bypass the lock. Most other JSON stores (`folders`, `history`, `saved_queries`, `default_queries`, `settings`, `shell_history`, `known_hosts`, `node_tags`, `collection_history`, `keybindings`, `export_watermarks`, `operations`) share the same shape via the generic `JsonStore<T>` in `json_store.rs`. `tabs.rs` and `storage/mod.rs` are deliberately bespoke — each carries a comment saying why. |
| `persist.rs` | `atomic_write()` — write-to-temp-then-rename so a crash can't leave a truncated file. Shared by every JSON store. |
| `keychain.rs` | Secrets (passwords, SSH key passphrases) in the OS keychain, keyed by connection id (SSH secrets under `id::ssh-*`). Configs on disk are credential-free. |
| `ssh.rs` / `known_hosts/mod.rs` | Optional SSH tunnel (pure-Rust `russh`) with trust-on-first-use host-key verification: unchanged key accepted, new host prompts, changed key refused. |
| `shell/` | Embedded JS shell ("IntelliShell"): `engine.rs` runs one `boa` context per session on its own worker thread; `bridge/mod.rs` exposes the `db` object that forwards to the driver. |
| `uri/mod.rs` | `build_uri()` assembles the connection string from a config; `with_timeout()` appends MongoDB timeout params; `tcp_probe()` does a fast TCP check before the MongoDB handshake. |
| `error.rs` | `AppError` enum serialized as `{ code, message }` so the frontend gets a stable category plus a human-readable message. |
| `menu.rs` | Native OS menu (source of truth). Also opens the document editor/viewer as a **second Tauri webview window** at `src/pages/document.html` (registered as a Vite entry in `vite.config.js`). See "Native menu" below. |

### Native menu

The app menu is the **native OS menu**, built entirely in `src-tauri/src/menu.rs` (macOS
system menu bar with the standard application menu + ⌘ accelerators; native in-window menu on
Windows/Linux). There is no in-window Vue menu bar — the old `src/components/Menubar.vue` was
removed.

- **Structure** is a data table (`menus()`): each item has an id, label, optional accelerator, and
  an optional `Gate` (`Connection` / `Database` / `Collection` / `AnyConnection` / `Document` /
  `DocumentField` / `Index`). Placeholders are
  the `built:false` features — carried over as present-but-disabled items.
- **Clicks** → `handle_event` emits `menu-action` with the item id → `App.vue` listens and routes
  through the existing `handleMenuAction` (same handlers the toolbar/right-click use). Actions are
  never reimplemented in Rust.
- **Enable/disable** reflects the current selection, which is the UNION of the active tab **and the
  sidebar/tree selection** (`ConnectionTree` emits `select-node` / `connections-changed`). The
  frontend `menuContext` (see `src/utils/menuContext.js`, unit-tested) is pushed to Rust via the
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

### Design conventions

- **Dialog headers must not have macOS traffic lights.** Only the real OS window gets them. Dialogs use a centered title + a single close ✕ button on the right.
- All colors come from CSS custom properties in `src/assets/theme.css` — never hardcode hex values that already exist as tokens.
- Icons are inline SVG rendered by `BaseIcon.vue` via a `name` prop — add new icons there, never use external icon fonts or raster images.

---

## Code quality

`npm run lint` runs eslint with unused-code rules only — no style rules, no formatter — and is
not yet a CI gate. CI runs `npm test`, `cargo test`, and the file-size check below; every other
rule here is enforced by review, so they have to be short enough to actually hold in your head.

### Where code goes

- **Logic that can be tested without a DOM belongs in `src/utils/`** (pure functions) **or
  `src/composables/`** (stateful, reusable). Components render and wire events; they don't parse,
  format, derive, or transform. The tell: every one of the frontend specs sits in
  `utils/`, `composables/`, `stores/` or `constants/` — there are no component tests, because
  there is not supposed to be anything in a component worth testing.
- **A composable owns one slice of state end to end.** If two composables both mutate the same
  thing, one of them is wrong — collapse them or move the state into `src/stores/`.
- **Rust: `commands/*` are thin.** A `#[tauri::command]` resolves its client via `ctx.client()`
  (or `ctx.client_for_write()` when it mutates), calls into real logic, and maps errors. Business
  logic that grows past a screenful moves to a sibling module so it can be unit-tested without a
  live MongoDB.

### File size

**Hard limit: 500 lines. Soft limit: 400.** Both enforced by `npm run check:size`, run in CI:
past 400 it warns and you justify the file in review, past 500 it fails. Line count is a smell
proxy, not the actual rule — a 450-line file of flat, obvious cases is fine, a 300-line file
doing four jobs is not.

**Every line in the file counts** — a `.vue` template included. What you scroll through to follow
the thing is the honest measure, and a template long enough to blow the limit is asking for
subcomponents exactly as much as a long script is.

**Tests are exempt** (`*.test.js`, `*.test.rs`, `tests.rs`, `*.fixtures.js`). A spec grows with the
cases it covers; a limit that counts them buys shorter files by deleting coverage.

The limit was 600 while the repo still had god files. They're gone, so it dropped to the 400 this
document had already named as the soft limit — with 500 as the hard gate for now, on the way to
400 once the over-limit files clear.

**Eight files are over 500 today** and the check names them on every run — that listing is the debt
register, so don't copy the numbers here. New files get no grace.

**Splitting a god file is its own change.** Never bundle it with a feature or a fix (see Workflow).
When you touch an over-limit file for another reason, leave it no bigger than you found it.

### Tests

- **Write the test first.** New logic in `utils/`, `composables/`, `stores/` or any Rust module
  ships with its spec in the same change, not a follow-up.
- **Frontend:** spec next to the source — `src/utils/format.js` → `src/utils/format.test.js`.
- **Rust:** sidecar file pulled in with `#[cfg(test)] #[path = "x.test.rs"] mod tests;` (see the
  foot of `storage/mod.rs`), so tests don't inflate the module they cover.
- A bug fix gets a test that fails before it and passes after. No test, no fix.

### Dependencies

Six devDependencies and a deliberately small crate list — keep it that way. A new dependency
needs a reason a few lines of code can't cover, and the user approves it before it lands. The
inverse also holds: don't hand-roll what an already-installed library does (the codebase uses
`sqlparser`, `boa`, `russh` rather than home-grown equivalents).

### Comments

Comments say **why**, never what. The existing ones explain history and constraints — why
`tabs.rs` is bespoke instead of a `JsonStore<T>`, why accelerators are skipped on Linux, why CI is
Linux-only. If a comment restates the code, delete it; if the code needs a comment to be followed
at all, the code is the thing to fix. Keep comments as small as possible.

### Errors

Rust returns `AppError` so the frontend gets `{ code, message }` — a stable code to branch on plus
a human-readable message. The frontend reads that shape through `src/utils/errors.js` — use those
helpers rather than touching `e.message` directly. Never surface a raw driver error string to the
UI, and never swallow one into a generic "something went wrong": map it to a code.

---

## Workflow

This project is human-delivered, AI-developed. The human must stay in full control of what ships.

- **One logical change per session.** Never bundle unrelated changes into a single response. If a task touches more than ~3 files, split it into steps and confirm with the user between each step.
- **Explain before committing.** Always describe what changed and why in plain language before reporting the work as done. No code jargon — write as if explaining to someone who will review the diff.
- **Never mix refactoring with bug fixes.** Each commit must have a single concern. If a bug fix requires a refactor, do them in separate steps.
- **Always verify the tests compile and pass** after any Rust change before reporting done. Run
  `cargo test` inside `src-tauri/` — not `cargo build`. Test modules are `#[cfg(test)]`, so a build
  can pass while the test tree is broken; that is exactly how a split once landed on main with an
  orphaned test importing a function it had just made private.
- **Let the user commit.** Do not create git commits unless explicitly asked. Explain the change, then wait.
- **Never write long and verbose, detailed git commit messages, just include high-level overview of what has been done
- **Commit message format** is the one in [`CONTRIBUTING.md`](CONTRIBUTING.md#commit-messages):
  `type: short summary`, one concern per commit. It lives there rather than here so contributors and
  agents can't drift apart.
- **Stage explicit paths.** Never `git add -A` or `git add .` — hand-maintained files (CHANGELOG,
  local notes, scratch plans) must not ride along on someone else's commit.
- **No trailers.** No `Co-Authored-By`, no "generated with" line. The commit says what changed; who
  typed it is not part of the record.
