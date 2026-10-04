use super::*;

fn change(kind: &str, object: Option<&str>, privileges: &[&str]) -> PgPrivilegeChange {
    PgPrivilegeChange {
        role: String::from("app"),
        object_kind: String::from(kind),
        schema: String::from("public"),
        object: object.map(String::from),
        privileges: privileges.iter().map(|p| p.to_string()).collect(),
        grant_option: false,
        cascade: false,
    }
}

fn validation_message(result: Result<String, AppError>) -> String {
    match result {
        Err(AppError::Validation(message)) => message,
        other => panic!("expected a validation error, got {other:?}"),
    }
}

#[test]
fn grants_on_a_table_name_the_schema_and_table_as_identifiers() {
    let sql = statement_template(&change("table", Some("orders"), &["select", "INSERT"]), true).unwrap();
    assert_eq!(sql, "GRANT SELECT, INSERT ON TABLE %I.%I TO %I");
}

#[test]
fn views_and_other_relations_use_on_table() {
    for kind in ["view", "matview", "partitioned_table", "foreign_table"] {
        let sql = statement_template(&change(kind, Some("v"), &["SELECT"]), true).unwrap();
        assert_eq!(sql, "GRANT SELECT ON TABLE %I.%I TO %I", "{kind}");
    }
}

#[test]
fn sequences_and_schemas_use_their_own_keyword() {
    let seq = statement_template(&change("sequence", Some("orders_id_seq"), &["USAGE"]), true).unwrap();
    assert_eq!(seq, "GRANT USAGE ON SEQUENCE %I.%I TO %I");
    let schema = statement_template(&change("schema", None, &["USAGE", "CREATE"]), true).unwrap();
    assert_eq!(schema, "GRANT USAGE, CREATE ON SCHEMA %I TO %I");
}

#[test]
fn grant_option_and_cascade_are_spelled_out() {
    let mut grant = change("table", Some("orders"), &["SELECT"]);
    grant.grant_option = true;
    assert_eq!(statement_template(&grant, true).unwrap(), "GRANT SELECT ON TABLE %I.%I TO %I WITH GRANT OPTION");

    let mut revoke = change("table", Some("orders"), &["SELECT"]);
    assert_eq!(statement_template(&revoke, false).unwrap(), "REVOKE SELECT ON TABLE %I.%I FROM %I RESTRICT");
    revoke.cascade = true;
    assert_eq!(statement_template(&revoke, false).unwrap(), "REVOKE SELECT ON TABLE %I.%I FROM %I CASCADE");
}

#[test]
fn privileges_are_deduplicated_in_a_fixed_order() {
    let sql = statement_template(&change("table", Some("t"), &["delete", "SELECT", "Delete"]), true).unwrap();
    assert_eq!(sql, "GRANT SELECT, DELETE ON TABLE %I.%I TO %I");
}

#[test]
fn a_privilege_the_object_kind_lacks_is_refused() {
    let message = validation_message(statement_template(&change("sequence", Some("s"), &["INSERT"]), true));
    assert!(message.contains("INSERT"), "{message}");
    // Anything not on the list is refused before it can reach SQL text.
    validation_message(statement_template(&change("table", Some("t"), &["SELECT; DROP TABLE t"]), true));
}

#[test]
fn incomplete_changes_are_refused() {
    validation_message(statement_template(&change("table", Some("t"), &[]), true));
    validation_message(statement_template(&change("table", None, &["SELECT"]), true));
    validation_message(statement_template(&change("function", Some("f"), &["EXECUTE"]), true));
    let mut no_role = change("schema", None, &["USAGE"]);
    no_role.role = String::from("  ");
    validation_message(statement_template(&no_role, true));
}
