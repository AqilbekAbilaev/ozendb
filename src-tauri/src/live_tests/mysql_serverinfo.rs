//! Live tests of MySQL's Server Info, against the server `mysql.rs` describes.

use super::mysql::{test_config, SKIP};
use super::mysql_browse::pool;
use crate::commands::{mysql_server_info, MySqlServerValue};

fn value(values: &[MySqlServerValue], name: &str) -> String {
    values.iter().find(|v| v.name == name).map(|v| v.value.clone()).unwrap()
}

#[tokio::test]
async fn the_server_reports_its_variables_and_status() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let info = mysql_server_info(&pool(&config).await).await.unwrap();
    assert!(value(&info.variables, "version").starts_with("8."));
    assert!(value(&info.variables, "max_connections").parse::<u32>().is_ok());
    assert!(value(&info.status, "Uptime").parse::<u64>().unwrap() > 0);
    assert!(value(&info.status, "Threads_connected").parse::<u32>().unwrap() > 0);
}
