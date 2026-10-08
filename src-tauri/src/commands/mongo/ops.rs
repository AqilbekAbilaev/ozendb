use crate::error::AppError;
use mongodb::bson;
use tauri::State;

use super::AppContext;

/// Run admin `currentOp` for a connection — the operations in progress on the server.
/// Returned raw as JSON; the frontend lists the `inprog` array.
///
/// `own_only` maps to `$ownOps`, which filters by authenticated *user* rather than by
/// connection — on a server without access control it therefore filters nothing. `all`
/// maps to `$all`, adding idle connections and internal threads.
#[tauri::command]
pub async fn current_ops(
    ctx: State<'_, AppContext>,
    id: String,
    own_only: Option<bool>,
    all: Option<bool>,
) -> Result<serde_json::Value, AppError> {
    let client = ctx.client(&id).await?;
    let command = bson::doc! {
        "currentOp": 1,
        "$ownOps": own_only.unwrap_or(false),
        "$all": all.unwrap_or(false),
    };
    let result = client.database("admin").run_command(command).await?;
    Ok(serde_json::Value::from(bson::Bson::Document(result)))
}

/// An opid as the server reports it: an integer on mongod, a `"shard:opid"` string on
/// mongos. It arrives from the frontend as JSON, and `killOp` matches on type — a number
/// that reaches the server as a Double kills nothing — so the conversion is explicit.
fn opid_to_bson(opid: &serde_json::Value) -> Result<bson::Bson, AppError> {
    match opid {
        serde_json::Value::Number(n) => match n.as_i64() {
            Some(v) => Ok(bson::Bson::Int64(v)),
            None => Err(AppError::Bson(format!("opid is not a whole number: {}", n))),
        },
        serde_json::Value::String(s) => Ok(bson::Bson::String(s.clone())),
        other => Err(AppError::Bson(format!("unusable opid: {}", other))),
    }
}

/// Kill one server operation by its opid — what the Current Operations tab's "Kill
/// Operation" does. Resolved through the write-gated client: a connection the user
/// flagged read-only has no business stopping work on the server. (Cancelling this app's
/// own query is a different path — `kill_query`, which matches on the run id it stamped.)
#[tauri::command]
pub async fn kill_op(
    ctx: State<'_, AppContext>,
    id: String,
    opid: serde_json::Value,
) -> Result<(), AppError> {
    let op = match opid_to_bson(&opid) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    let client = ctx.client_for_write(&id).await?;
    let command = bson::doc! { "killOp": 1, "op": op };
    client.database("admin").run_command(command).await?;
    Ok(())
}

#[cfg(test)]
#[path = "ops.test.rs"]
mod tests;
