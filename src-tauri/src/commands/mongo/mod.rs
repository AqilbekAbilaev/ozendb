//! MongoDB's commands. `commands` re-exports them flat, so `lib.rs`'s handler list and
//! every `crate::commands::…` path read the same as before they moved here.

// The files here reach `AppContext`, `tracked`, `MAX_QUERY_TIME` and the CSV helpers as
// `super::…`; this keeps those paths resolving one level down.
use super::*;

pub mod query;
pub mod admin;
pub mod shell;
pub mod schema;
pub mod sql;
pub mod stats;
pub mod duplicate;
pub mod serverinfo;
pub mod profiler;
pub mod search;
pub mod gridfs;
pub mod users;
pub mod functions;
pub mod mapreduce;
pub mod copyops;
pub mod portmap;
pub mod history;
pub mod ops;

pub use query::*;
pub use admin::*;
pub use shell::*;
pub use schema::*;
pub use sql::*;
pub use stats::*;
pub use duplicate::*;
pub use serverinfo::*;
pub use profiler::*;
pub use search::*;
pub use gridfs::*;
pub use users::*;
pub use functions::*;
pub use mapreduce::*;
pub use copyops::*;
pub use portmap::*;
pub use history::*;
pub use ops::*;

// Extended JSON parsing, shared by the commands above. Re-exported so
// `crate::commands::parse_ejson_document` keeps resolving.
mod ejson;
pub(crate) use ejson::*;
