use crate::uri::percent_encode;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

// Default window mode when the frontend omits it (defensive; the frontend always sends it).
fn default_mode() -> String {
    String::from("edit")
}

// The document a pop-out editor window is pointed at. Sent from the frontend as a plain
// object (camelCase), passed on the first-open URL, and re-broadcast as the
// `document-target` event when the single window is retargeted at a different document.
#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTarget {
    pub conn_id: String,
    pub db: String,
    pub coll: String,
    pub id_filter: String,
    pub label: String,
    // "edit" — the single, focus-locked editor window; "view" — an unlimited, read-only
    // display window; "insert" — the single, focus-locked new-document window (no target
    // document; id_filter is unused).
    #[serde(default = "default_mode")]
    pub mode: String,
}


// Monotonic sequence for unique read-only view-window labels. View windows are unlimited
// and independent, so each open gets its own label (unlike the single editor window).
static VIEW_WINDOW_SEQ: AtomicU64 = AtomicU64::new(0);

// Open a document window.
//
// - mode "edit": the SINGLE reusable editor window (label "doc-editor"). If it already
//   exists we re-point it via the `document-target` event and focus it. On first build it
//   is focus-locked over the app — always-on-top + focused, so it can't be buried
//   ("cannot be unfocused"; Tauri 2.3.1 has no native modal, so this is the approximation).
// - mode "view": an unlimited, non-modal, hideable read-only window (unique label each).
// - mode "insert": the SINGLE reusable new-document window (label "doc-insert"), same
//   focus-locked, retargetable behaviour as the editor but with no seeded document.
//
// Either way the initial target is seeded on the URL query so the first load has its
// document even before the page registers its `document-target` listener.
pub fn open_document_window(app: &AppHandle, target: DocumentTarget) {
    let is_view = target.mode == "view";
    let is_insert = target.mode == "insert";

    // The editor and insert windows are single reusable windows; view windows never
    // retarget. Insert has no per-document target, but retargeting still lets a fresh
    // "+" on another collection re-point the open window at that collection.
    if !is_view {
        let reuse_label = if is_insert { "doc-insert" } else { "doc-editor" };
        if let Some(w) = app.get_webview_window(reuse_label) {
            match app.emit_to(reuse_label, "document-target", target.clone()) {
                Ok(val) => val,
                Err(_e) => (),
            };
            w.set_focus().ok();
            return;
        }
    }

    let query = format!(
        "connId={}&db={}&coll={}&idFilter={}&label={}&mode={}",
        percent_encode(&target.conn_id),
        percent_encode(&target.db),
        percent_encode(&target.coll),
        percent_encode(&target.id_filter),
        percent_encode(&target.label),
        percent_encode(&target.mode),
    );
    let url = format!("src/pages/document.html?{}", query);

    let label = if is_view {
        let seq = VIEW_WINDOW_SEQ.fetch_add(1, Ordering::Relaxed);
        format!("doc-view-{}", seq)
    } else if is_insert {
        String::from("doc-insert")
    } else {
        String::from("doc-editor")
    };
    let title = if is_view {
        "View Document"
    } else if is_insert {
        "Insert Document"
    } else {
        "Edit Document"
    };

    // Give the OS window a dark background so it appears in-theme immediately instead of a
    // white flash while the webview loads its bundle and paints the document.
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(720.0, 640.0)
        .resizable(true)
        .center()
        .focused(true)
        .background_color(tauri::window::Color(31, 32, 35, 255));

    // The editor floats above the main window so it can't be buried; view windows stay
    // normal (non-modal, hideable, can sit behind other windows).
    if !is_view {
        builder = builder.always_on_top(true);
    }

    builder.build().ok();
}

