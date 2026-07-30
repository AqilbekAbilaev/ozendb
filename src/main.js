import { createApp } from "vue";
import "./assets/theme.css";
import "./assets/dialogs.css";
import App from "./App.vue";

// Pre-paint the theme from the localStorage mirror before mount so light-theme
// users don't see a dark flash. App.vue loads the authoritative value from
// settings and keeps this mirror in sync.
document.documentElement.dataset.theme = localStorage.getItem("s4t-theme") || "dark";

createApp(App).mount("#app");
