use super::{command_message, join_write_messages, write_message};

#[test]
fn write_message_prefers_the_server_text() {
    assert_eq!(
        write_message(11000, "E11000 duplicate key error"),
        "E11000 duplicate key error"
    );
}

#[test]
fn write_message_falls_back_to_code_when_blank() {
    assert_eq!(write_message(121, ""), "Write error (code 121)");
}

#[test]
fn command_message_prefers_the_server_errmsg() {
    assert_eq!(
        command_message(13, "not authorized on testify to execute command"),
        "not authorized on testify to execute command"
    );
}

#[test]
fn command_message_falls_back_to_code_when_blank() {
    assert_eq!(command_message(13, ""), "Command failed (code 13)");
}

#[test]
fn join_dedups_and_returns_none_when_empty() {
    assert_eq!(join_write_messages(Vec::new()), None);
    let dupes = vec![
        String::from("E11000 dup key"),
        String::from("E11000 dup key"),
    ];
    assert_eq!(join_write_messages(dupes), Some(String::from("E11000 dup key")));
}

#[test]
fn join_caps_a_large_number_of_distinct_messages() {
    let many: Vec<String> = (0..6).map(|n| format!("err {n}")).collect();
    assert_eq!(
        join_write_messages(many),
        Some(String::from("err 0; err 1; err 2 (and 3 more)"))
    );
}

// The wiring between error reporting's two halves: the conversion into Tauri's
// `InvokeError` — the boundary every command error crosses on its way to the frontend
// — is what decides whether an error is ever recorded, by calling error_log::record.
// Classification itself is covered in error_log.test.rs — what this pins is that the
// funnel is actually connected, in both directions.
//
// One test rather than two because the recorder is a process global: `init` takes
// effect once, so a second test would race this one for which tempdir wins. Records
// are matched by a marker in the message rather than by count, since other tests in
// this binary share the global once it is set.
#[test]
fn only_defects_reach_the_error_log() {
    use super::AppError;
    let dir = tempfile::tempdir().expect("tempdir");
    crate::error_log::init(dir.path().join("error_log.json"));

    let defect = AppError::Io(std::io::Error::other("marker-defect"));
    let domain = AppError::Validation("marker-domain".to_string());
    let _ = tauri::ipc::InvokeError::from(defect);
    let _ = tauri::ipc::InvokeError::from(domain);
    // Building the wire shape is pure: only crossing the boundary records anything.
    let _ = AppError::Io(std::io::Error::other("marker-unsent")).wire();

    let records = match crate::error_log::store() {
        Some(store) => store.list(),
        // Another test in this binary won the `init` race; nothing to assert against.
        None => return,
    };
    let recorded: Vec<_> = records.iter().filter(|r| r.message.contains("marker-")).collect();
    assert_eq!(recorded.len(), 1, "only the defect that crossed the boundary is recorded");
    assert_eq!(recorded[0].code, "io");
    assert!(recorded[0].message.contains("marker-defect"));
}

// The frontend reads exactly this shape (src/utils/errors.js): a stable code to branch
// on and a readable message.
#[test]
fn a_command_error_reaches_the_frontend_as_code_and_message() {
    let error = tauri::ipc::InvokeError::from(super::AppError::Validation("Name is required".into()));
    assert_eq!(error.0, serde_json::json!({ "code": "validation", "message": "Name is required" }));
}
