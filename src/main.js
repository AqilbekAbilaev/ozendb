import { createApp } from "vue";
import "./assets/theme.css";
import "./assets/dialogs.css";
import App from "./App.vue";
import { installErrorReporting, describeError } from "./utils/errorReport";

// Pre-paint the theme from the localStorage mirror before mount so light-theme
// users don't see a dark flash. App.vue loads the authoritative value from
// settings and keeps this mirror in sync.
document.documentElement.dataset.theme = localStorage.getItem("s4t-theme") || "dark";

// Installed before mount so an exception thrown during setup is still recorded.
const report = installErrorReporting();

const app = createApp(App);
// Vue swallows errors thrown inside components (it logs and carries on), so they never
// reach window.onerror — this is the only way they're seen.
app.config.errorHandler = (err) => {
  report(describeError(err));
  console.error(err);
};
app.mount("#app");
