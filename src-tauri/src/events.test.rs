use super::*;

#[test]
fn every_backend_event_has_a_frontend_subscriber() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/appApi/events.js");
    let frontend = std::fs::read_to_string(&path).unwrap();
    for name in [MENU_ACTION, OPERATIONS_CHANGED, DOCUMENT_TARGET, SSH_HOST_KEY_PROMPT, SSH_HOST_KEY_CHANGED] {
        assert!(
            frontend.contains(&format!("subscribe('{name}')")),
            "src/appApi/events.js has no subscriber for `{name}`"
        );
    }
}
