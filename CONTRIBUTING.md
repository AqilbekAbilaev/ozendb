# Contributing to OzenDB

Thanks for your interest in improving OzenDB — an open-source, free desktop GUI for MongoDB.
Contributions of all kinds are welcome: bug reports, features, docs, and fixes.

## Contributor License Agreement (required)

OzenDB is offered under a **dual-license** model: the community edition is **GPL-3.0**, and a
separate commercial license funds ongoing development. So that this stays possible, **all
contributions require agreeing to the [Contributor License Agreement](CLA.md)** before they can be
merged.

For now, indicate your agreement by adding this line to your pull request description:

> I have read and agree to the OzenDB Contributor License Agreement.

(An automated CLA check may be added later.)

## Getting started

**Prerequisites**

- [Node.js](https://nodejs.org/) (LTS) and npm
- [Rust](https://www.rust-lang.org/tools/install) via `rustup` (a recent stable toolchain — the
  embedded JS shell needs cargo ≥ 1.88)
- Tauri 2 system dependencies for your OS — see the
  [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)

**Run the app**

```bash
npm install
npm run tauri dev        # Vite dev server + Tauri shell
```

**Verify your changes**

```bash
cd src-tauri && cargo build   # Rust must compile after any backend change
cd src-tauri && cargo test    # Rust unit tests
npm test                      # Frontend unit tests (Vitest)
```

## Making a change

1. **Open an issue first** for anything non-trivial, so we can agree on the approach before you
   invest time.
2. **Branch** off `main` and keep each pull request focused on a **single logical change** — don't
   bundle unrelated fixes and refactors together.
3. **Match the surrounding code.** Follow the naming, structure, and comment style already in the
   file you're editing. Project-wide architecture notes live in
   [`CLAUDE.md`](CLAUDE.md) and [`ROADMAP.md`](ROADMAP.md).
4. **Keep the build green** — `cargo build`, `cargo test`, and `npm test` should all pass before you
   open the PR.
5. **Describe what changed and why** in the PR, in plain language, and include the CLA agreement
   line above.

## Commit messages

One concern per commit — don't bundle a refactor into a fix. Subject line:

```
type: short summary in the imperative
```

`type` is one of **feat**, **fix**, **refactor**, **perf**, **docs**, **test** or **chore**, with an
optional scope (`refactor(app): move modal routing out of app`). Lowercase, no trailing period, and
reach for `feat:`/`refactor:` rather than vaguer verbs like `add:` or `change:`.

Add a body only when the *why* isn't clear from the diff. None of this is enforced by a hook or a
CI check — it's review convention, so that `git log --oneline` stays readable.

## Reporting bugs

Open a [GitHub issue](https://github.com/AqilbekAbilaev/ozendb/issues) with:

- Your OS and version (Windows / macOS / Linux distro)
- Steps to reproduce
- What you expected vs. what happened
- Any error text from the terminal or the in-app console

## License

By contributing, you agree that your contributions will be licensed under the project's
[GPL-3.0 license](LICENSE), and that the Project Owner may also license them commercially as
described in the [CLA](CLA.md).
