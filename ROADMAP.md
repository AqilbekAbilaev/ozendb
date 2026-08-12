# OzenDB Roadmap

A high-level view of what's done and what's next. OzenDB targets MongoDB today, with a
longer-term goal of supporting more databases.

## Done ✅

 - **Foundation** — Tauri + Vue desktop app with a native system menu; async connection pool;
   a Rust backend with unit and integration tests; crash-safe atomic storage; Linux/WebKitGTK
   rendering and text-editing fixes; downloadable pre-built binaries for macOS, Windows, and Linux;
   signed automatic updates, checked on launch and from the Help menu (macOS, Windows and Linux
   AppImage — `.deb`/`.rpm` installs belong to the package manager and are pointed at the
   downloads page instead).
- **Connections** — Connection Manager (create / edit / duplicate / import / export / delete);
   structured connection fields with a live Test Connection; passwords in the OS keychain;
   TLS/SSL; SSH tunnels with trust-on-first-use host-key verification; OIDC workload-identity
   auth (MONGODB-OIDC); color tags; a connection tree with per-connection status.
- **Querying** — collection-bound tabs that persist across restarts; a query bar
   (filter / sort / projection / skip / limit); Find and aggregation modes; Explain; query
   history; save / load queries; a visual query builder; result paging and document counts.
- **Results & editing** — Table, JSON, and Tree views; a shell-code view; inline cell editing;
   nested drill-down; insert / replace / delete documents; collection history with per-document
   restore; copy helpers; drag-to-reorder columns (persisted).
- **Collections, databases & indexes** — create / drop / rename collections; create / drop
   databases; index management; import / export to JSON and CSV; cross-server collection copy
   via paste.
- **Data tools** — GridFS; schema analysis with Word (.docx) documentation export; SQL → MQL
   translation; data masking; map-reduce; collection search.
- **Admin & server** — server status / info, users & roles (including copying users to another
   connection with roles and a temporary password), profiler, current operations, validators,
   and background tasks.
- **Shell** — IntelliShell, an embedded mongosh-style JavaScript shell with a CodeMirror editor,
   Mongo-aware autocomplete, a persistent per-session context, per-connection history, and
   save / open of `.js` scripts.
- **Personalization** — light / dark theme toggle; customizable keyboard shortcuts (rebind the
   menu-action combos, applied live in-app and on the native menu bar).

## Planned 📋

- **Reschema** — collection schema transformation and migration tool. Deliberately deferred: the
   earlier requirements document was removed rather than carried forward, so that the core
   querying, results and admin features are finished to a solid standard first and Reschema is
   built on top of them.
- **Interactive OIDC sign-in (human SSO)** — the device-authorization browser-login flow
   with token caching and trusted-endpoint config, for Atlas / enterprise single sign-on.
   Workload-identity OIDC (`MONGODB-OIDC` with `ENVIRONMENT` / `TOKEN_RESOURCE`) already ships;
   this adds the human login path 3T markets. Premium/corporate tier.
- Support for databases beyond MongoDB (longer term)
