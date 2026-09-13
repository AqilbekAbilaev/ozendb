import { createApp } from "vue";
import "../assets/theme.css";
import DocumentEditorPage from "../components/results/DocumentEditorPage.vue";
import { installInputUndo } from "../utils/inputUndo";
import { prePaintTheme } from "../utils/themeMirror";

// This editor is a separate webview, so it loads its own stylesheet and pre-paints
// from the shared mirror the main window keeps in sync.
prePaintTheme();

createApp(DocumentEditorPage).mount("#doc-editor-app");

// This window is a separate webview, so it needs its own undo shim (WebKitGTK has
// no native Ctrl+Z for text fields).
installInputUndo();
