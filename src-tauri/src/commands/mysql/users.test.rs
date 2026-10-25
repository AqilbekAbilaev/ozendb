use super::*;

fn user(name: &str, password: Option<&str>) -> NewMySqlUser {
    NewMySqlUser { user: String::from(name), host: String::from("%"), password: password.map(String::from) }
}

#[test]
fn creates_an_account_with_its_password_quoted_as_a_string() {
    let sql = create_statement(&user("o'brien ü", Some(r"pa'ss\word"))).unwrap();
    assert_eq!(sql, r"CREATE USER 'o''brien ü'@'%' IDENTIFIED BY 'pa''ss\\word'");
}

#[test]
fn creates_an_account_without_a_password_when_none_is_given() {
    assert_eq!(create_statement(&user("app", None)).unwrap(), "CREATE USER 'app'@'%'");
}

#[test]
fn refuses_an_account_without_a_user_name_or_a_host() {
    assert!(matches!(create_statement(&user(" ", None)), Err(AppError::Validation(_))));
    let no_host = NewMySqlUser { host: String::new(), ..user("app", None) };
    assert!(matches!(create_statement(&no_host), Err(AppError::Validation(_))));
}
