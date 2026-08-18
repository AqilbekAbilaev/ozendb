// The MongoDB `db` bridge for the embedded shell.
//
// A single native function `__mongo({ collection, method, args })` is registered
// on each JS context. A JS preamble builds `db` as a Proxy whose property access
// (`db.users`) yields a collection object whose methods forward to `__mongo`.
//
// `boa`'s native functions are synchronous, so each driver call is run to
// completion with `Handle::block_on`. The current connection (client + database
// + runtime handle) lives in a shared slot that the worker rebinds before every
// evaluation — see engine.rs.

use std::cell::RefCell;
use std::rc::Rc;

use boa_engine::{js_string, Context, JsError, JsString, JsValue, NativeFunction, Source};
use boa_gc::{Finalize, Trace};
use boa_engine::error::JsNativeError;
use mongodb::bson;
use mongodb::Client;
use tokio::runtime::Handle;

mod driver;

/// `find()` without an explicit `.limit()` returns at most this many documents,
/// so a bare `db.coll.find({})` on a large collection can't hang the shell
/// fetching everything (mongosh shows a small batch for the same reason).
/// Server-side time cap so a slow shell query aborts instead of pinning the
/// session's worker thread.
const MAX_QUERY_TIME: std::time::Duration = std::time::Duration::from_secs(60);
const DEFAULT_FIND_LIMIT: i64 = 20;
/// Hard ceiling on documents materialized by a single find/aggregate, so an
/// explicit large `.limit()` or a huge pipeline can't exhaust memory.
const MAX_DOCS: usize = 5000;

/// The live connection a shell session is bound to. Rebound before each eval.
pub(super) struct DbInner {
    pub client: Client,
    pub db_name: String,
    pub handle: Handle,
    pub read_only: bool,
}

/// Capture handed to the native `__mongo` function. Holds only an `Rc` to the
/// connection slot — no GC-traceable members, hence the empty trace.
#[derive(Trace, Finalize)]
#[boa_gc(unsafe_empty_trace)]
pub(super) struct DbContext {
    pub slot: Rc<RefCell<Option<DbInner>>>,
}

/// Register `__mongo` and install the `db` Proxy preamble on a context.
pub(super) fn install_db(context: &mut Context, slot: Rc<RefCell<Option<DbInner>>>) {
    let captures = DbContext { slot: slot };
    let mongo = NativeFunction::from_copy_closure_with_captures(
        |_this, args, captures: &DbContext, context| mongo_call(args, captures, context),
        captures,
    );
    let _ = context.register_global_callable(js_string!("__mongo"), 1, mongo);

    // Generates a fresh ObjectId hex string for `ObjectId()` with no argument.
    let new_oid = NativeFunction::from_copy_closure(|_this, _args, _context| {
        let hex = bson::oid::ObjectId::new().to_hex();
        Ok(JsValue::from(JsString::from(hex.as_str())))
    });
    let _ = context.register_global_callable(js_string!("__newOid"), 0, new_oid);

    let _ = context.eval(Source::from_bytes(DB_PREAMBLE));
}

/// `db` is a Proxy so `db.<anyCollection>` resolves dynamically (including
/// not-yet-created collections, which MongoDB creates on first write).
/// `find` / `aggregate` return a lazy cursor (chainable + iterable); a bare
/// cursor left as the completion value is auto-materialized for display (see
/// engine.rs). Extended-JSON constructors round-trip into BSON on the Rust side.
const DB_PREAMBLE: &str = r#"
    (function () {
        function call(name, method, args) {
            return globalThis.__mongo({ collection: name, method: method, args: args });
        }
        function makeCursor(name, method, spec) {
            var cache = null;
            var pos = 0;
            function run() {
                if (cache === null) {
                    var args = method === 'find'
                        ? [spec.filter || {}, spec.projection || {}, spec.sort || {}, spec.skip || 0, spec.limit || 0]
                        : [spec.pipeline || []];
                    cache = call(name, method, args);
                    pos = 0;
                }
                return cache;
            }
            var cursor = {
                __isCursor: true,
                limit:      function (n) { spec.limit = n; cache = null; return cursor; },
                skip:       function (n) { spec.skip = n; cache = null; return cursor; },
                sort:       function (s) { spec.sort = s; cache = null; return cursor; },
                projection: function (p) { spec.projection = p; cache = null; return cursor; },
                toArray:    function () { return run(); },
                pretty:     function () { return run(); },
                count:      function () { return method === 'find' ? call(name, 'countDocuments', [spec.filter || {}]) : run().length; },
                size:       function () { return method === 'find' ? call(name, 'countDocuments', [spec.filter || {}]) : run().length; },
                forEach:    function (fn) { var a = run(); for (var i = 0; i < a.length; i++) { fn(a[i], i); } },
                map:        function (fn) { var a = run(); var out = []; for (var i = 0; i < a.length; i++) { out.push(fn(a[i], i)); } return out; },
                hasNext:    function () { run(); return pos < cache.length; },
                next:       function () { run(); return pos < cache.length ? cache[pos++] : null; },
            };
            return cursor;
        }
        function makeCollection(name) {
            return {
                find:                   function (q, p) { return makeCursor(name, 'find', { filter: q || {}, projection: p || {} }); },
                findOne:                function (q, p) { return call(name, 'findOne', [q || {}, p || {}]); },
                insertOne:              function (d)    { return call(name, 'insertOne', [d]); },
                insertMany:             function (d)    { return call(name, 'insertMany', [d]); },
                updateOne:              function (q, u) { return call(name, 'updateOne', [q, u]); },
                updateMany:             function (q, u) { return call(name, 'updateMany', [q, u]); },
                replaceOne:             function (q, r) { return call(name, 'replaceOne', [q, r]); },
                deleteOne:              function (q)    { return call(name, 'deleteOne', [q]); },
                deleteMany:             function (q)    { return call(name, 'deleteMany', [q]); },
                countDocuments:         function (q)    { return call(name, 'countDocuments', [q || {}]); },
                estimatedDocumentCount: function ()     { return call(name, 'estimatedDocumentCount', []); },
                distinct:               function (f, q) { return call(name, 'distinct', [f, q || {}]); },
                aggregate:              function (p)    { return makeCursor(name, 'aggregate', { pipeline: p || [] }); },
                drop:                   function ()     { return call(name, 'drop', []); },
                createIndex:            function (k, o) { return call(name, 'createIndex', [k, o || {}]); },
                dropIndex:              function (n)    { return call(name, 'dropIndex', [n]); },
                renameCollection:       function (n)    { return call(name, 'renameCollection', [n]); },
            };
        }
        var base = {
            getCollection: function (name) { return makeCollection(name); },
            runCommand:    function (cmd)  { return globalThis.__mongo({ collection: null, method: 'runCommand', args: [cmd] }); },
        };
        globalThis.db = new Proxy(base, {
            get: function (target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop === 'symbol') return undefined;
                return makeCollection(prop);
            }
        });
        globalThis.ObjectId = function (id) {
            return { $oid: (id === undefined || id === null) ? globalThis.__newOid() : String(id) };
        };
        globalThis.ISODate = function (s) {
            return { $date: (s === undefined || s === null) ? new Date().toISOString() : String(s) };
        };
        globalThis.NumberLong = function (n) { return { $numberLong: String(n) }; };
        globalThis.NumberInt = function (n) { return { $numberInt: String(n) }; };
        globalThis.NumberDecimal = function (n) { return { $numberDecimal: String(n) }; };
    })();
"#;

/// The native dispatcher: decode the operation, run it on the driver, hand the
/// result back to JS. A failed operation throws a JS error so it surfaces in the
/// transcript as a normal exception.
fn mongo_call(args: &[JsValue], captures: &DbContext, context: &mut Context) -> JsResult {
    let op = match args.first() {
        Some(value) => value,
        None => return Err(throw("__mongo: missing operation descriptor")),
    };
    let op_json = match op.to_json(context) {
        Ok(Some(value)) => value,
        Ok(None) => return Err(throw("__mongo: operation is undefined")),
        Err(e) => return Err(e),
    };

    // Copy out the live connection so we don't hold the RefCell borrow across
    // the blocking driver call.
    let bound = {
        let slot = captures.slot.borrow();
        match slot.as_ref() {
            Some(inner) => (
                inner.client.clone(),
                inner.db_name.clone(),
                inner.handle.clone(),
                inner.read_only,
            ),
            None => return Err(throw("no database is bound to this shell session")),
        }
    };
    let (client, db_name, handle, read_only) = bound;

    match driver::run_op(&client, &db_name, &handle, read_only, &op_json) {
        Ok(value) => JsValue::from_json(&value, context),
        Err(message) => Err(throw(&message)),
    }
}

type JsResult = boa_engine::JsResult<JsValue>;

fn throw(message: &str) -> JsError {
    JsNativeError::error().with_message(message.to_string()).into()
}

/// Shell methods that mutate data or schema. On a read-only connection these are
/// refused before they reach the driver (see the gate in `run_op`).
pub(crate) fn is_write_method(method: &str) -> bool {
    matches!(
        method,
        "insertOne" | "insertMany" | "updateOne" | "updateMany" | "replaceOne"
            | "deleteOne" | "deleteMany" | "drop" | "createIndex" | "dropIndex"
            | "renameCollection"
    )
}

/// Whether one decoded shell operation writes, and so must be refused on a
/// read-only connection. Three ways an op can write:
///   - the method itself mutates (`insertOne`, `drop`, …);
///   - `runCommand` carrying a write command (`{ drop: "users" }`);
///   - an aggregation whose pipeline ends in `$out` / `$merge`.
pub(crate) fn op_writes(method: &str, args: &[serde_json::Value]) -> bool {
    if is_write_method(method) {
        return true;
    }
    if method == "aggregate" {
        return match args.first() {
            Some(pipeline) => pipeline_writes(pipeline),
            None => false,
        };
    }
    if method == "runCommand" {
        let command = match args.first().and_then(|value| value.as_object()) {
            Some(map) => map,
            None => return false,
        };
        if command.keys().any(|key| is_write_command(key)) {
            return true;
        }
        // `{ aggregate: "c", pipeline: [ { $out: … } ] }` writes without naming a
        // write command.
        return match command.get("pipeline") {
            Some(pipeline) => pipeline_writes(pipeline),
            None => false,
        };
    }
    false
}

/// MongoDB command names that write, for gating `runCommand` on a read-only
/// connection.
///
/// Checked against *every* top-level key of the command document rather than just
/// the first. MongoDB's rule is that the command name comes first, and today that
/// survives the trip through `serde_json::Value` — but only because a transitive
/// dependency (`schemars`, via tauri) turns on `serde_json/preserve_order`, which
/// this crate neither requests nor controls. If that flag ever goes away the map
/// falls back to a `BTreeMap` and `{ insert: …, documents: [...] }` would present
/// `documents` first, silently letting the write through. Scanning every key costs
/// nothing and cannot be broken that way.
pub(crate) fn is_write_command(name: &str) -> bool {
    matches!(
        name,
        "insert"
            | "update"
            | "delete"
            | "findAndModify"
            | "findandmodify"
            | "drop"
            | "dropDatabase"
            | "dropIndexes"
            | "create"
            | "createIndexes"
            | "renameCollection"
            | "collMod"
            | "convertToCapped"
            | "cloneCollectionAsCapped"
            | "emptycapped"
            | "compact"
            | "createUser"
            | "updateUser"
            | "dropUser"
            | "dropAllUsersFromDatabase"
            | "grantRolesToUser"
            | "revokeRolesFromUser"
            | "createRole"
            | "updateRole"
            | "dropRole"
            | "dropAllRolesFromDatabase"
            | "grantPrivilegesToRole"
            | "revokePrivilegesFromRole"
            | "grantRolesToRole"
            | "revokeRolesFromRole"
            | "applyOps"
            | "setParameter"
            | "shutdown"
            | "killOp"
            | "fsync"
            | "mapReduce"
            | "mapreduce"
    )
}

/// True when an aggregation pipeline ends in a stage that writes. `$out` replaces a
/// collection and `$merge` upserts into one, so an aggregate is only a read as long
/// as neither appears — which is why `aggregate` isn't in `is_write_method`.
pub(crate) fn pipeline_writes(pipeline: &serde_json::Value) -> bool {
    match pipeline.as_array() {
        Some(stages) => stages.iter().any(|stage| match stage.as_object() {
            Some(map) => map.contains_key("$out") || map.contains_key("$merge"),
            None => false,
        }),
        None => false,
    }
}

/// Dispatch one decoded `{ collection, method, args }` operation to the driver,
/// blocking on the async call via the provided runtime handle.

#[cfg(test)]
use driver::{arg_doc, to_document};

#[cfg(test)]
#[path = "bridge.test.rs"]
mod tests;
