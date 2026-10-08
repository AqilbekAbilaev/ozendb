use super::validate_target;

fn existing() -> Vec<String> {
    vec!["users".to_string(), "orders".to_string()]
}

#[test]
fn accepts_a_fresh_name() {
    assert!(validate_target("users", "users_copy", &existing()).is_ok());
}

#[test]
fn trims_whitespace() {
    assert!(validate_target("users", "  users_copy  ", &existing()).is_ok());
}

#[test]
fn rejects_empty_name() {
    assert!(validate_target("users", "   ", &existing()).is_err());
}

#[test]
fn rejects_same_as_source() {
    assert!(validate_target("users", "users", &existing()).is_err());
}

#[test]
fn rejects_existing_collection() {
    let err = validate_target("users", "orders", &existing()).unwrap_err();
    assert!(err.contains("already exists"));
}

#[test]
fn rejects_existing_after_trim() {
    assert!(validate_target("users", "  orders  ", &existing()).is_err());
}
