import { createApp } from "vue";
import "./assets/theme.css";
import "./assets/dialogs.css";
// Order is load-bearing: every static import below evaluates before this body runs,
// so a createWorkspace at module scope would hit an empty registry.
import { registerWorkspaceDefinitions } from "./workspaces/registerDefinitions";
import { initializeTabs } from "./stores/tabs";
import App from "./App.vue";
import { installErrorReporting, describeError } from "./utils/errorReport";
import { recordFrontendError } from "./appApi/errorLog";
import { prePaintTheme } from "./utils/themeMirror";
import { installInputUndo } from "./utils/inputUndo";
import { checkOnLaunch } from "./stores/updater";
import { refreshPremium } from "./stores/premium";
import { startSyncStatus, syncedDataVersion } from "./stores/sync";
import { refreshOpenConnections } from "./stores/openConnections";
import { watch } from "vue";
import { loadSettings, restoreSessionEnabled, editorTabWidth } from "./stores/settings";
import { EDITOR_TAB_WIDTH } from "./constants/injectionKeys";
import { useSessionPersistence } from "./composables/useSessionPersistence";
import { ENGINES } from "./engines/index.js";

prePaintTheme();

// WebKitGTK has no native undo/redo for text fields. Installed here rather than in a
// component so HMR can't stack duplicate listeners on the shared document.
installInputUndo();

// Installed before mount so an exception thrown during setup is still recorded.
const report = installErrorReporting(recordFrontendError);

registerWorkspaceDefinitions();
initializeTabs();

const app = createApp(App);
app.provide(EDITOR_TAB_WIDTH, editorTabWidth);
// Vue swallows errors thrown inside components (it logs and carries on), so they never
// reach window.onerror — this is the only way they're seen.
app.config.errorHandler = (err) => {
  report(describeError(err));
  console.error(err);
};
app.mount("#app");

// Whatever an engine connects for itself once the app is up (its `start`).
for (const engine of Object.values(ENGINES)) engine.start?.();

// Settings before the session, so restored workspaces adopt the stored defaults; the
// update check last, so its dialog can't land on a tab strip that is still restoring.
const { initializeSession, startAutoSave } = useSessionPersistence();
loadSettings()
  .then(() => initializeSession({ restore: restoreSessionEnabled.value }))
  .then(() => { startAutoSave(); checkOnLaunch(); });
// Premium and sync depend on nothing above, so they are read alongside rather than queued behind it.
refreshPremium();
startSyncStatus();
// A sync that wrote other devices' changes here: the sidebar and settings show them.
watch(syncedDataVersion, () => {
  refreshOpenConnections().catch(() => {});
  loadSettings();
});
