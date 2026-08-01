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

# Verify Rust compiles after any backend change
cd src-tauri && cargo build

# Run Rust unit tests
cd src-tauri && cargo test

# Frontend-only Vite dev server (no Tauri; invoke() calls won't work)
npm run dev

# Run frontend unit tests (Vitest; specs live next to sources, e.g. src/utils/*.test.js)
npm test
```

---

## Architecture

**Stack:** Tauri 2 (Rust backend) + Vue 3 (frontend, Vite). No router, no Pinia — plain `ref`/`computed`.

### Data flow

```
App.vue  (composes the panes; owns split-pane sizing and handleContextAction)
  ├── app/Toolbar.vue            (global toolbar actions)
  ├── connection/ConnectionTree.vue  (sidebar; list_connections, list_databases on mount/expand)
  ├── query/QueryWorkspace.vue   (tabs + query UI; emits run-query → App.vue calls find_documents)
  ├── app/OperationsPane.vue     (surface for long-running operations)
  ├── app/AppModals.vue          (renders every top-level modal, incl. ConnectionManager → NewConnection)
  └── base/ContextMenu.vue       (handled entirely in App.vue's handleContextAction)
```

Components are grouped by area under `src/components/`: `admin/`, `app/`, `base/`, `connection/`, `query/`, `results/`, `tools/`.

Most app state and logic live in `src/composables/*` (`useModals`, `useQueryRunner`, `useDbActions`, `useMenu`, `useOperations`, `useSessionPersistence`, …) — `useModals` owns the open-state for every modal. App.vue composes these and passes props/handlers down; treat the composable as the source of truth for its slice.

**Tab state** lives in `src/stores/tabs.js` — module-scope `tabs` / `activeTabId` refs plus every tab mutation (activate/close/cycle/duplicate/reorder/rename), shared by every importer. Tabs are plain objects and children mutate their properties directly (e.g. `tab.filter`, `tab.skip`), which works because Vue 3 makes array items reactive. The tab *creators* — what a newly opened tab of each kind contains — live in `src/composables/useTabCreators.js`, which App.vue constructs with the query runner and the settings-backed defaults they need. Note: module-scope refs do not survive Vite HMR cleanly — restart the dev server before blaming the code for stale tab state.

### Rust backend (`src-tauri/src/`)

| File | Responsibility |
|---|---|
| `commands/` | All `#[tauri::command]` functions, split by area (`query`, `admin`, `connection`, `schema`, `sql`, `gridfs`, `stats`, `search`, `profiler`, `duplicate`, `copyops`, `users`, `mapreduce`, …) and re-exported from `commands/mod.rs`. `mod.rs` also holds shared helpers — notably `client_for(pool, storage, id)`, the single entry point every command uses to resolve a connection to a live client, plus the EJSON/CSV parse helpers. |
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
  editing keys) and `App.vue`'s `onGlobalKeydown` keeps the JS shortcuts instead — gated by
  `NATIVE_MENU_OWNS_SHORTCUTS`.
- The gate→enabled derivation is unit-tested in `menu.rs` (`cargo test`) and `menuContext.test.js`
  (`npm test`).

### Design conventions

- **Dialog headers must not have macOS traffic lights.** Only the real OS window gets them. Dialogs use a centered title + a single close ✕ button on the right.
- All colors come from CSS custom properties in `src/assets/theme.css` — never hardcode hex values that already exist as tokens.
- Icons are inline SVG rendered by `BaseIcon.vue` via a `name` prop — add new icons there, never use external icon fonts or raster images.

---

## Code quality

There is no linter or formatter in this repo. CI runs `npm test`, `cargo test`, and the file-size
check below — every other rule here is enforced by review, so they have to be short enough to
actually hold in your head.

### Where code goes

- **Logic that can be tested without a DOM belongs in `src/utils/`** (pure functions) **or
  `src/composables/`** (stateful, reusable). Components render and wire events; they don't parse,
  format, derive, or transform. The tell: every one of the frontend specs sits in
  `utils/`, `composables/`, `stores/` or `constants/` — there are no component tests, because
  there is not supposed to be anything in a component worth testing.
- **A composable owns one slice of state end to end.** If two composables both mutate the same
  thing, one of them is wrong — collapse them or move the state into `src/stores/`.
- **Rust: `commands/*` are thin.** A `#[tauri::command]` resolves its client via `client_for`,
  calls into real logic, and maps errors. Business logic that grows past a screenful moves to a
  sibling module so it can be unit-tested without a live MongoDB.

### File size

**Hard limit: 600 lines** for any `.js`, `.vue` or `.rs` file. Enforced — `npm run check:size`,
run in CI. Soft limit 400: not enforced, but past 400 expect to justify the file in review.
Line count is a smell proxy, not the actual rule — a 500-line file of flat, obvious cases is fine,
a 300-line file doing four jobs is not.

Ten files were already over 600 when the limit landed. `scripts/check-file-size.mjs` pins each at
the length it had that day: they may shrink, never grow, and the check tells you to delete the pin
once a file drops under the limit. So the list is the debt register — it is the one place those
numbers live, don't copy them here. New files get no such grace.

**Splitting a god file is its own change.** Never bundle it with a feature or a fix (see Workflow).
When you touch a pinned file for another reason, leave it no bigger than you found it.

### Tests

- **Write the test first.** New logic in `utils/`, `composables/`, `stores/` or any Rust module
  ships with its spec in the same change, not a follow-up.
- **Frontend:** spec next to the source — `src/utils/format.js` → `src/utils/format.test.js`.
- **Rust:** sidecar file pulled in with `#[cfg(test)] #[path = "x.test.rs"] mod tests;` (see the
  foot of `storage/mod.rs`), so tests don't inflate the module they cover.
- A bug fix gets a test that fails before it and passes after. No test, no fix.

### Dependencies

Four devDependencies and a deliberately small crate list — keep it that way. A new dependency
needs a reason a few lines of code can't cover, and the user approves it before it lands. The
inverse also holds: don't hand-roll what an already-installed library does (the codebase uses
`sqlparser`, `boa`, `russh` rather than home-grown equivalents).

### Comments

Comments say **why**, never what. The existing ones explain history and constraints — why
`tabs.rs` is bespoke instead of a `JsonStore<T>`, why accelerators are skipped on Linux, why CI is
Linux-only. If a comment restates the code, delete it; if the code needs a comment to be followed
at all, the code is the thing to fix.

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
- **Always verify the build compiles** after any Rust change before reporting done. Run `cargo build` inside `src-tauri/` and confirm it succeeds.
- **Let the user commit.** Do not create git commits unless explicitly asked. Explain the change, then wait.
- **Never write long and verbose, detailed git commit messages, just include high-level overview of what has been done
