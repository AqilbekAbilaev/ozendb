# Coding rules

The rules for code in OzenDB, for every contributor, human or AI. How the codebase fits together
is in [`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Architecture

**Stack:** Tauri 2 (Rust backend) + Vue 3 (frontend, Vite). No router, no Pinia — plain `ref`/`computed`.

The map — data flow, every layer and store, the Tauri boundary, workspaces, engines, the Rust
modules, the native menu — is [`ARCHITECTURE.md`](../ARCHITECTURE.md). Read the relevant section
before adding a store, a workspace type, an engine, a backend command or a menu item.

These hold everywhere; most are enforced:

- **Layers import inwards only:** `components/` → `composables/` → `stores/` → `utils/`.
  `no-restricted-imports` in `eslint.config.js` and `src/importCycles.test.js` enforce it. State
  one leaf writes and another reads goes in `src/stores/`, not through App.vue props and emits.
- **Only `src/appApi/` and `src/engines/*/api/` call `invoke`**, and Tauri events go through
  `src/appApi/events.js` alone. `src/appApi/apiBoundary.test.js` enforces it; a new
  engine-neutral command is added to its list.
- **Nothing creates a workspace during module evaluation.** `main.js` registers the definitions
  before seeding tabs, and every static import runs before that.
- **Never compare engine names.** Ask `src/engines/` — `no-restricted-syntax` enforces it.
- **New code takes a ResourceRef** (`src/utils/resourceRef.js`). Names are opaque: never parse them
  by `/` or `.`. The flat `{ connId, dbName, … }` shapes are legacy, not a pattern to copy.
- **Menu actions are never reimplemented in Rust.** `menu.rs` builds the menu; clicks route back to
  the same handlers the toolbar and right-click use.
- Module-scope refs do not survive Vite HMR cleanly — restart the dev server before blaming the
  code for stale tab state.

## Design conventions

- **Dialog headers must not have macOS traffic lights.** Only the real OS window gets them. Dialogs use a centered title + a single close ✕ button on the right.
- All colors come from CSS custom properties in `src/assets/theme.css` — never hardcode hex values that already exist as tokens.
- Icons are inline SVG rendered by `BaseIcon.vue` via a `name` prop — add new icons there, never use external icon fonts or raster images.

---

## Code quality

CI runs `npm run lint`, `npm test`, `cargo test`, and the file-size check below. Lint covers
correctness and dead code — ESLint's recommended set, Vue's essentials, the layering rules, and
a handful more (`prefer-const`, `eqeqeq`, `no-console`, `vue/require-prop-types`,
`vue/no-unused-properties`). It deliberately carries **no style rules and no formatter**: the
`flat/strongly-recommended` tier is ~4,000 whitespace findings and adopting it would rewrite
every template in one commit. Every other rule here is enforced by review, so they have to be
short enough to actually hold in your head.

**Fix what lint and clippy flag; don't silence it.** No new `eslint-disable` or `#[allow]` — the
two crate-wide clippy allows in `lib.rs` are the only ones.

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
- **Inline a value used once.** A local variable earns its name by being reused or by explaining
  something the expression doesn't.
- **A function either changes state or returns a value, not both.** Name commands as verbs
  (`closeTab`) and queries as nouns (`activeTab`).
- **Every `TODO` names its issue** — `// TODO #281: …`. Defer work that way rather than leaving it
  half-done or unrecorded.

### Objects

Elegant Objects, SOLID, DDD, YAGNI and DRY, for code that models a thing with behaviour — a Rust
type with methods, or any JS class:

- **Immutable.** Fields are set once; a change builds a new value. No setters.
- **The constructor only assigns.** `new` takes what it needs and stores it; work happens in methods.
- **One to four fields.** A fifth means two objects are sharing a type.
- **Expose behaviour, not fields.** No getters that hand back internals for the caller to act on.
- **Compose, don't inherit.** Prefer a trait over a shared base.
- **No `-er`, `Manager`, `Helper` or `Util` names.** Name the thing, not the job.
- **No type introspection or casting** — no `Any` downcasts, no `instanceof` branching.

**Exempt, because the architecture depends on them:** pure functions in `src/utils/`; plain-data
shapes — workspaces, ResourceRefs, serde structs crossing the Tauri boundary; Vue components,
composables and stores, whose reactivity works by mutation; and long-lived resources that exist to
hold changing state behind a lock — the connection pool, SSH tunnels, shell sessions. Parsing
untrusted input (EJSON, CSV, driver results) may inspect types.

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
400 once the files past the soft limit clear.

**The check names every file past 400 on each run** — that listing is the debt register, so don't
copy the count here. New files get no grace.

**Splitting a god file is its own change.** Never bundle it with a feature or a fix (see Workflow in [`AGENTS.md`](../AGENTS.md)).
When you touch an over-limit file for another reason, leave it no bigger than you found it.

### Tests

- **Write the test first.** New logic in `utils/`, `composables/`, `stores/` or any Rust module
  ships with its spec in the same change, not a follow-up.
- **Frontend:** spec next to the source — `src/utils/format.js` → `src/utils/format.test.js`.
- **Rust:** sidecar file pulled in with `#[cfg(test)] #[path = "x.test.rs"] mod tests;` (see the
  foot of `storage/mod.rs`), so tests don't inflate the module they cover.
- A bug fix gets a test that fails before it and passes after. No test, no fix.
- **One behaviour per test, named as a sentence** — `it('keeps the sign of the swipe direction')`.
- **No test depends on another's leftovers.** Reset module-scope stores in `beforeEach`.
- **Mock only at the Tauri boundary** (`@tauri-apps/*`, `appApi/`, `engines/*/api/`). Stores,
  composables and utils run for real; a hand-written fake beats a `vi.mock` inside the app. Rust
  tests use a real filesystem in a temporary directory.
- **Use irregular inputs** — names with spaces, dots, slashes and non-ASCII, not `foo`. Resource
  names are opaque, and only awkward ones prove it.
- **Tests run offline and quiet:** no network beyond the live-test servers, ephemeral ports, a
  timeout on every wait, no logging.
- **Keep tests short.** A test that needs a long setup is pointing at code that does too much.
- **Pass explicit arguments**, not defaults, so a changed default can't make a test pass by accident.
- **Inline small fixtures; build large ones with a function** rather than storing big literals.
- **Concurrent code gets a concurrent test** — the connection pool and the shell worker thread are
  exercised from several tasks at once, not only one call at a time.

### Dependencies

A short devDependency list and a deliberately small crate list — keep it that way. A new dependency
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

An `AppError` message is one sentence naming what failed and where — the connection, database or
collection.

**Fail fast.** Throw rather than return `null` unless the value is genuinely allowed to be
missing; a `null` the caller forgets to check fails somewhere far from its cause.
