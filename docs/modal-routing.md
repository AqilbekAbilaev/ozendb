**Status:** not started

# Work 10: Remove Modal Event Routing From App

## Goal

Remove modal-specific prop and event routing from `App.vue`. Domain owners should open modals with the data and callbacks required for that modal session, while `AppModals.vue` remains a generic renderer.

This work should substantially reduce App-level orchestration without replacing it with a global event bus or another giant injected context.

## Dependencies

- Work 9 removes structural `saved -> App -> ConnectionTree` refresh routing.
- Workspace/tab creation APIs from Works 5 and 6 are stable.
- Existing modal registry and `useModals` tests are passing.
- Work 1 API ownership is complete for modal domain operations.

## Current Routing To Remove

`App.vue` currently owns or maps:

```text
modalEmits
modalProps
STRUCTURAL_DIALOGS
connection manager connect
validator saved
import configure
export source choose
preferences saved
keybindings saved
update install/download
```

`AppModals.vue` receives these maps through `provide('appModals')` and reconstructs listeners/props at render time.

## Target Modal API

Extend `useModals()`:

```js
openModal(id, payload?, {
  props?,
  on?,
})

closeModal(id)
isModalOpen(id)
modalOptions(id)
```

Keep target payload separate from session options:

- Modal keys serialize payload only.
- Callbacks are never included in keys.
- Existing mutable target payloads remain possible.
- Options are removed when the modal closes.
- Reopening the same ID replaces both payload and options.

Use shallow storage or `markRaw` for callbacks and computed refs. Do not deep-proxy functions.

## Target Ownership

| Concern | Owner after Work 10 |
|---|---|
| Generic open/close/render | `useModals` and `AppModals` |
| Structural resource refresh | Resource store/mutating component from Work 9 |
| Connection manager navigation | Connection navigation store |
| Preferences state/save | Settings store |
| Update props/actions | `useUpdater` |
| Import/export picker transition | Workspace/tab creation owner |
| Validator completion/toast | Validator domain component/controller |
| Modal-specific backend calls | Modal/domain owner |

## Reviewable Changes

### Change 10A: Per-Open Modal Options

Files: 3

1. Update `src/composables/useModals.js`.
2. Update `src/composables/useModals.test.js`.
3. Update `src/components/app/AppModals.vue` with temporary fallback to old App maps.

Tests:

- Open stores payload separately from options.
- Close clears both.
- Reopen replaces both.
- Multiple modal IDs remain independent.
- Callback identity remains stable.
- Reactive/computed props remain reactive.
- Modal key excludes functions/options.
- Generic close is always bound.

### Change 10B: Connection Navigation Store

Files: 2

1. Add `src/stores/connectionNavigation.js`.
2. Add `src/stores/connectionNavigation.test.js`.

API:

```js
connectionOpenRequest
requestConnectionOpen(connectionId)
consumeConnectionOpenRequest()
```

Include a nonce/generation so requesting the same connection twice still triggers.

### Change 10C: Tree Consumes Navigation Requests

Files: 3

1. Update `useConnectionTree.js`.
2. Update `ConnectionTree.vue`.
3. Update `App.vue`.

Remove:

- `expandConnectionId` App state.
- `expandId` prop.
- `expanded` event used only for App coordination.

The tree observes/consumes navigation requests directly.

### Change 10D: Connection Manager And Quickstart Ownership

Files: 2

1. Update `ConnectionManager.vue`.
2. Update `QuickstartPane.vue`.

On connect/open:

1. Persist current open/last-accessed behavior.
2. Request connection navigation through the store.
3. Close the manager when appropriate.

Remove `onManagerConnect` from App in a separate App cleanup checkpoint if needed.

### Change 10E: Settings Store

Files: 2

1. Add `src/stores/settings.js`.
2. Add `src/stores/settings.test.js`.

Own:

```text
defaultQueryLimit
theme
defaultResultView
restoreSessionEnabled
editorTabWidth
keyBindings
loadSettings
savePreferences
saveKeybindings
setTheme
```

Tests:

- Backend values are normalized and adopted.
- Theme updates document state and localStorage mirror.
- Failed saves do not mutate live settings.
- Keybindings merge consistently.
- Defaults remain deterministic.
- Test reset/HMR behavior is explicit.

### Change 10F: Adopt Settings Ownership

Files: 3

1. Update `App.vue`.
2. Update `PreferencesModal.vue`.
3. Update `useAppMenuActions.js`.

Changes:

- App imports settings refs instead of owning duplicate refs and save handlers.
- Preferences loads/saves through the settings store and emits only `close`.
- Requested initial preference tab is supplied as per-open modal props.
- Remove `onPrefsSaved`, `onKeybindingsSaved`, and preferences map entries.

Preserve startup ordering: settings load completes before session restore decisions and defaulted workspace creation.

### Change 10G: Updater Owns Update Modal Session

Files: 3

1. Update `useUpdater.js`.
2. Update `useUpdater.test.js`.
3. Update `App.vue`.

When opening the update modal, the updater supplies:

- Reactive dialog props.
- Install handler.
- Downloads fallback handler.

Remove update entries from App's prop/event maps. Keep `UpdateModal.vue` presentation-only.

### Change 10H: Import And Export Picker Ownership

First checkpoint, files: 2

1. Update `useTabCreators.js`.
2. Update `useTabCreators.test.js`.

`openExportSource()` and `openImportWizard()` open picker modals with owner-supplied listeners that create the correct workspace and close the picker.

Callbacks must capture the target from the modal-open moment rather than reading mutable global modal state later.

Second checkpoint, files: 2

1. Update `useDbTransfer.js`.
2. Update `App.vue`.

Remove old configure/choose routing and dead ownership.

### Change 10I: Validator Completion Becomes Local

Files: 2

1. Update `ValidatorModal.vue`.
2. Update `App.vue`.

After successful save, the validator owner shows the current toast and closes. Remove `onValidatorSaved` and its map entry.

### Change 10J: Remove Compatibility Maps

Files: 3

1. Update `AppModals.vue`.
2. Update `App.vue`.
3. Update `modalRegistry.js` comments/tests if needed.

Remove:

```text
ctx.modalEmits
ctx.modalProps
modalEmits
modalProps
comments describing App-owned modal routing
```

`AppModals.vue` binds only:

- Generic close.
- Payload-derived target.
- Per-open options owned by the opener.

### Change 10K: Remove Giant Handler Injection

Use separate checkpoints of at most three files.

First migrate panes to direct stable services/stores:

```text
ImportPane.vue
CsvImportPane.vue
IndexManagerPane.vue
```

Then remove dead `handlers`/`prefs` provision from:

```text
App.vue
QuickstartPane.vue
AppModals.vue, if applicable
```

The remaining injection may temporarily carry index overlay state, SSH prompts, tab rename state, and the modal API. Eliminating that entire bundle is separate work.

## Behavior Invariants

- Generic close behavior remains identical.
- Target-prefilled modals remount when opened for another target.
- Different modal IDs remain independently openable.
- Connection Manager connect still opens/expands the selected connection.
- Quickstart recent connections use the same navigation behavior.
- Preferences opens on the requested tab every time.
- Settings changes remain live after save.
- Failed preference saves keep the dialog open.
- Update launch/manual behavior and reactive progress remain unchanged.
- Import/export pickers create identical workspace state.
- Validator success displays the same notification.

## Out Of Scope

- Index-detail and index-drop overlays.
- SSH host-key and rename-tab overlays.
- Local query/result modals outside the top-level registry.
- Removing the entire `appModals` injection bundle.
- Native/context menu decomposition.
- Workspace/session architecture changes.
- Backend changes.
- Converting Vue files to TypeScript.

## Verification

```bash
npm test -- src/composables/useModals.test.js
npm test -- src/stores/connectionNavigation.test.js
npm test -- src/stores/settings.test.js
npm test -- src/composables/useUpdater.test.js
npm test -- src/composables/useTabCreators.test.js
npm test
npm run check:size
npm run build
```

Searches:

```bash
rg -n "modalEmits|modalProps|STRUCTURAL_DIALOGS" src/App.vue src/components/app/AppModals.vue
rg -n "appModals\.handlers|bundle\.handlers" src
```

Expected result: no modal event maps or giant handler consumers remain.

## Risks

- Deep-reactive callback storage can proxy functions.
- Computed update props can lose reactivity when copied incorrectly.
- Including options in modal keys can serialize functions or remount continuously.
- Same-ID connection requests require nonce semantics.
- Settings ownership must not reorder session initialization.
- Import/export ownership can create circular dependencies if tab creators and transfer composables call each other.

## Acceptance Criteria

- `App.vue` contains no `modalEmits`, `modalProps`, `STRUCTURAL_DIALOGS`, or modal-specific completion handlers.
- `AppModals.vue` is a generic host using opener-owned session options.
- Preferences, updater, connection navigation, validator, import, and export behavior belongs to domain owners.
- Structural dialogs no longer route through App.
- No consumer reads `appModals.handlers` or `bundle.handlers`.
- App shrinks below its current file-size ceiling.
- Tests, size check, and production build pass.
