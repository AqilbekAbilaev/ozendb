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

The map — data flow, every layer and store, the Tauri boundary, workspaces, engines, the Rust
modules, the native menu — is [`ARCHITECTURE.md`](ARCHITECTURE.md). Read the relevant section
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

### Design conventions

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
400 once the files past the soft limit clear.

**The check names every file past 400 on each run** — that listing is the debt register, so don't
copy the count here. New files get no grace.

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

---

## Workflow

This project is human-delivered, AI-developed. The human must stay in full control of what ships.

- **Tasks live in [GitHub Issues](https://github.com/AqilbekAbilaev/ozendb/issues).** Labels carry the
  type (`bug`, `enhancement`, `task`, `chore`, `epic`, `decision`) and priority (`P1`–`P4`); an epic's
  work is its sub-issues. A PR closes its issue with `Closes #N` in the description. #92–#157 are the
  closed history migrated from the old Beads tracker.
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
