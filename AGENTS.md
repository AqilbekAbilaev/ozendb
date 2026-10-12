# CLAUDE.md


1. Ask, don't assume. If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements. When running unattended, pick the most reasonable interpretation, proceed, and record the assumption rather than blocking.

2. Implement the simplest solution for simple problems, better solutions for harder problems. Do not over-engineer or add flexibility that isn't needed yet. 

3. Don't touch unrelated code but please do surface bad code or design smells you discover with me so we can address them as a separate issue.

4. Flag uncertainty explicitly. If you're unsure about something, see point 1 above. If it makes sense to do so, conduct a small, localised and low-risk experiment and bring the hypothesis and results to me to discuss. Confidence without certainty causes more damage than admitting a gap.

6. Push back on technical mistakes, mine included. Vision and architecture are my call, so defer to me there.

7. Design top-down: settle the whole before the parts.

8. Write plain English in full sentences — in chat as much as in commits. No jargon, slang or shorthand.

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

## Coding rules

The rules for code in this repository — architecture, design, code quality, objects, tests,
errors — apply to every contributor and live in @docs/CODING.md. Follow them on every change.

---

## Workflow

This project is human-delivered, AI-developed. The human must stay in full control of what ships.

- **Tasks live in [GitHub Issues](https://github.com/AqilbekAbilaev/ozendb/issues).** Labels carry the
  type (`bug`, `enhancement`, `task`, `chore`, `epic`, `decision`) and priority (`P1`–`P4`); an epic's
  work is its sub-issues. A PR closes its issue with `Closes #N` in the description. #92–#157 are the
  closed history migrated from the old Beads tracker.
- **Pull before starting**, and branch off a fresh `main`.
- **Branch names carry the issue number:** `fix/263-index-default-name`. Ask when there is no issue.
- **A bug in a dependency gets an upstream issue**, not a workaround buried in our code. Suggest
  one; work around it only with the user's agreement and a comment linking the issue.
- **When a problem stays hard, add logging** rather than guessing, and remove it before committing.
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
