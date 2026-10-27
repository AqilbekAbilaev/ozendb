// The pop-out document editor window's entry (src/pages/document.html, which Rust opens
// by that path). The window is MongoDB's own, so its entry lives here.
import { createApp } from "vue";
import "../../../assets/theme.css";
import DocumentEditorPage from "./DocumentEditorPage.vue";
import { installInputUndo } from "../../../utils/inputUndo";
import { prePaintTheme, paintTheme } from "../../../utils/themeMirror";
import { onThemeChanged } from "../../../appApi/events";
import { editorTabWidth } from "../../../stores/settings";
import { EDITOR_TAB_WIDTH } from "../../../constants/injectionKeys";

// This editor is a separate webview, so it loads its own stylesheet and pre-paints
// from the shared mirror the main window keeps in sync.
prePaintTheme();
onThemeChanged(paintTheme);

createApp(DocumentEditorPage).provide(EDITOR_TAB_WIDTH, editorTabWidth).mount("#doc-editor-app");

// This window is a separate webview, so it needs its own undo shim (WebKitGTK has
// no native Ctrl+Z for text fields).
installInputUndo();
