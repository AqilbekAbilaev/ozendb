import { createApp } from "vue";
import "./assets/theme.css";
import "./assets/dialogs.css";
// Order is load-bearing: every static import below evaluates before this body runs,
// so a createWorkspace at module scope would hit an empty registry.
import { registerWorkspaceDefinitions } from "./workspaces/registerDefinitions";
import { initializeTabs } from "./stores/tabs";
import App from "./App.vue";
import { installErrorReporting, describeError } from "./utils/errorReport";
import { prePaintTheme } from "./utils/themeMirror";

prePaintTheme();

// Installed before mount so an exception thrown during setup is still recorded.
const report = installErrorReporting();

registerWorkspaceDefinitions();
initializeTabs();

const app = createApp(App);
// Vue swallows errors thrown inside components (it logs and carries on), so they never
// reach window.onerror — this is the only way they're seen.
app.config.errorHandler = (err) => {
  report(describeError(err));
  console.error(err);
};
app.mount("#app");
