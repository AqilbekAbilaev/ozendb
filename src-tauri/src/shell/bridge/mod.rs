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
use std::time::Duration;

use boa_engine::{js_string, Context, JsError, JsString, JsValue, NativeFunction, Source};
use boa_gc::{Finalize, Trace};
use boa_engine::error::JsNativeError;
use mongodb::bson;
use mongodb::options::IndexOptions;
use mongodb::{Client, Collection, IndexModel};
use tokio::runtime::Handle;

/// `find()` without an explicit `.limit()` returns at most this many documents,
/// so a bare `db.coll.find({})` on a large collection can't hang the shell
/// fetching everything (mongosh shows a small batch for the same reason).
/// Server-side time cap so a slow shell query aborts instead of pinning the
/// session's worker thread.
const MAX_QUERY_TIME: Duration = Duration::from_secs(60);
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

    match run_op(&client, &db_name, &handle, read_only, &op_json) {
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
fn run_op(
    client: &Client,
    db_name: &str,
    handle: &Handle,
    read_only: bool,
    op: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let method = match op.get("method").and_then(|value| value.as_str()) {
        Some(value) => value,
        None => return Err(String::from("operation has no method")),
    };

    let empty: Vec<serde_json::Value> = Vec::new();
    let args = match op.get("args").and_then(|value| value.as_array()) {
        Some(value) => value,
        None => &empty,
    };

    if read_only && op_writes(method, args) {
        return Err(String::from(
            "This connection is read-only — writes are disabled in the shell.",
        ));
    }
    let database = client.database(db_name);

    handle.block_on(async {
        if method == "runCommand" {
            let command = match arg_doc(args, 0) {
                Ok(doc) => doc,
                Err(e) => return Err(e),
            };
            return match database.run_command(command).await {
                Ok(doc) => Ok(bson_doc_to_json(doc)),
                Err(e) => Err(e.to_string()),
            };
        }

        let collection_name = match op.get("collection").and_then(|value| value.as_str()) {
            Some(value) => value,
            None => return Err(String::from("operation has no collection")),
        };
        let collection = database.collection::<bson::Document>(collection_name);

        match method {
            "find" => exec_find(&collection, args).await,
            "findOne" => exec_find_one(&collection, args).await,
            "insertOne" => exec_insert_one(&collection, args).await,
            "insertMany" => exec_insert_many(&collection, args).await,
            "updateOne" => exec_update(&collection, args, false).await,
            "updateMany" => exec_update(&collection, args, true).await,
            "replaceOne" => exec_replace_one(&collection, args).await,
            "deleteOne" => exec_delete(&collection, args, false).await,
            "deleteMany" => exec_delete(&collection, args, true).await,
            "countDocuments" => exec_count(&collection, args).await,
            "estimatedDocumentCount" => exec_estimated_count(&collection).await,
            "distinct" => exec_distinct(&collection, args).await,
            "aggregate" => exec_aggregate(&collection, args).await,
            "drop" => exec_drop(&collection).await,
            "createIndex" => exec_create_index(&collection, args).await,
            "dropIndex" => exec_drop_index(&collection, args).await,
            "renameCollection" => {
                exec_rename(client, db_name, collection_name, args).await
            }
            other => Err(format!("unsupported shell method: {}", other)),
        }
    })
}

// ── argument / result conversion ──────────────────────────────────────────

/// Decode a JS-object argument into a BSON document. Uses bson's serde Extended
/// JSON decoding — the same mechanism as `commands::parse_ejson_document`, so
/// `ObjectId("…")` / `{ $oid }` and friends round-trip correctly.
fn to_document(value: &serde_json::Value) -> Result<bson::Document, String> {
    match serde_json::from_value::<bson::Bson>(value.clone()) {
        Ok(bson::Bson::Document(doc)) => Ok(doc),
        Ok(bson::Bson::Null) => Ok(bson::Document::new()),
        Ok(_) => Err(String::from("expected a document argument")),
        Err(e) => Err(e.to_string()),
    }
}

/// Document argument at `index`, defaulting to an empty document when absent.
fn arg_doc(args: &[serde_json::Value], index: usize) -> Result<bson::Document, String> {
    match args.get(index) {
        Some(value) => to_document(value),
        None => Ok(bson::Document::new()),
    }
}

/// BSON → EJSON-preserving JSON (same conversion the find/aggregate commands use).
fn bson_doc_to_json(doc: bson::Document) -> serde_json::Value {
    serde_json::Value::from(bson::Bson::Document(doc))
}

// ── per-method executors ──────────────────────────────────────────────────

async fn exec_find(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    let mut query = collection.find(filter);

    // Positional args from the cursor: [filter, projection, sort, skip, limit].
    let projection = match arg_doc(args, 1) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    if !projection.is_empty() {
        query = query.projection(projection);
    }
    let sort = match arg_doc(args, 2) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    if !sort.is_empty() {
        query = query.sort(sort);
    }
    // JS numbers may decode as floats, so read through f64 then cast.
    if let Some(skip) = args.get(3).and_then(|value| value.as_f64()) {
        if skip > 0.0 {
            query = query.skip(skip as u64);
        }
    }
    // Default to a small batch when no limit is set; never fetch beyond MAX_DOCS.
    let requested = args
        .get(4)
        .and_then(|value| value.as_f64())
        .map(|value| value as i64)
        .unwrap_or(0);
    let effective_limit = if requested <= 0 {
        DEFAULT_FIND_LIMIT
    } else {
        requested.min(MAX_DOCS as i64)
    };
    query = query.limit(effective_limit).max_time(MAX_QUERY_TIME);

    let mut cursor = match query.await {
        Ok(value) => value,
        Err(e) => return Err(e.to_string()),
    };
    let mut docs = Vec::new();
    loop {
        let has_next = match cursor.advance().await {
            Ok(value) => value,
            Err(e) => return Err(e.to_string()),
        };
        if !has_next {
            break;
        }
        let doc: bson::Document = match cursor.deserialize_current() {
            Ok(value) => value,
            Err(e) => return Err(e.to_string()),
        };
        docs.push(bson_doc_to_json(doc));
    }
    Ok(serde_json::Value::Array(docs))
}

async fn exec_find_one(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    let mut query = collection.find_one(filter);
    if args.len() > 1 {
        let projection = match arg_doc(args, 1) {
            Ok(doc) => doc,
            Err(e) => return Err(e),
        };
        if !projection.is_empty() {
            query = query.projection(projection);
        }
    }
    match query.await {
        Ok(Some(doc)) => Ok(bson_doc_to_json(doc)),
        Ok(None) => Ok(serde_json::Value::Null),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_insert_one(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let doc = match arg_doc(args, 0) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    let result = match collection.insert_one(doc).await {
        Ok(value) => value,
        Err(e) => return Err(e.to_string()),
    };
    let mut out = serde_json::Map::new();
    out.insert(String::from("acknowledged"), serde_json::Value::Bool(true));
    out.insert(
        String::from("insertedId"),
        serde_json::Value::from(result.inserted_id),
    );
    Ok(serde_json::Value::Object(out))
}

async fn exec_insert_many(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let array = match args.first().and_then(|value| value.as_array()) {
        Some(value) => value,
        None => return Err(String::from("insertMany expects an array of documents")),
    };
    let mut docs = Vec::new();
    for item in array {
        match to_document(item) {
            Ok(doc) => docs.push(doc),
            Err(e) => return Err(e),
        }
    }
    let result = match collection.insert_many(docs).await {
        Ok(value) => value,
        Err(e) => return Err(e.to_string()),
    };
    let mut ids = serde_json::Map::new();
    for (index, id) in result.inserted_ids {
        ids.insert(index.to_string(), serde_json::Value::from(id));
    }
    let mut out = serde_json::Map::new();
    out.insert(String::from("acknowledged"), serde_json::Value::Bool(true));
    out.insert(
        String::from("insertedCount"),
        serde_json::Value::from(ids.len()),
    );
    out.insert(String::from("insertedIds"), serde_json::Value::Object(ids));
    Ok(serde_json::Value::Object(out))
}

async fn exec_update(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
    many: bool,
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    let update = match arg_doc(args, 1) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    let result = if many {
        collection.update_many(filter, update).await
    } else {
        collection.update_one(filter, update).await
    };
    match result {
        Ok(value) => Ok(update_result_to_json(value)),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_replace_one(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    let replacement = match arg_doc(args, 1) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    match collection.replace_one(filter, replacement).await {
        Ok(value) => Ok(update_result_to_json(value)),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_delete(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
    many: bool,
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    let result = if many {
        collection.delete_many(filter).await
    } else {
        collection.delete_one(filter).await
    };
    match result {
        Ok(value) => {
            let mut out = serde_json::Map::new();
            out.insert(String::from("acknowledged"), serde_json::Value::Bool(true));
            out.insert(
                String::from("deletedCount"),
                serde_json::Value::from(value.deleted_count),
            );
            Ok(serde_json::Value::Object(out))
        }
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_count(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let filter = match arg_doc(args, 0) {
        Ok(value) => value,
        Err(e) => return Err(e),
    };
    match collection.count_documents(filter).max_time(MAX_QUERY_TIME).await {
        Ok(value) => Ok(serde_json::Value::from(value)),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_aggregate(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let array = match args.first().and_then(|value| value.as_array()) {
        Some(value) => value,
        None => return Err(String::from("aggregate expects a pipeline array")),
    };
    let mut stages = Vec::new();
    for item in array {
        match to_document(item) {
            Ok(doc) => stages.push(doc),
            Err(e) => return Err(e),
        }
    }
    let mut cursor = match collection.aggregate(stages).max_time(MAX_QUERY_TIME).await {
        Ok(value) => value,
        Err(e) => return Err(e.to_string()),
    };
    let mut docs = Vec::new();
    loop {
        // Safety ceiling so a huge pipeline result can't exhaust memory.
        if docs.len() >= MAX_DOCS {
            break;
        }
        let has_next = match cursor.advance().await {
            Ok(value) => value,
            Err(e) => return Err(e.to_string()),
        };
        if !has_next {
            break;
        }
        let doc: bson::Document = match cursor.deserialize_current() {
            Ok(value) => value,
            Err(e) => return Err(e.to_string()),
        };
        docs.push(bson_doc_to_json(doc));
    }
    Ok(serde_json::Value::Array(docs))
}

fn update_result_to_json(result: mongodb::results::UpdateResult) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    out.insert(String::from("acknowledged"), serde_json::Value::Bool(true));
    out.insert(
        String::from("matchedCount"),
        serde_json::Value::from(result.matched_count),
    );
    out.insert(
        String::from("modifiedCount"),
        serde_json::Value::from(result.modified_count),
    );
    match result.upserted_id {
        Some(id) => {
            out.insert(String::from("upsertedId"), serde_json::Value::from(id));
        }
        None => {}
    }
    serde_json::Value::Object(out)
}

async fn exec_estimated_count(
    collection: &Collection<bson::Document>,
) -> Result<serde_json::Value, String> {
    match collection.estimated_document_count().await {
        Ok(value) => Ok(serde_json::Value::from(value)),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_distinct(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let field = match args.first().and_then(|value| value.as_str()) {
        Some(value) => value.to_string(),
        None => return Err(String::from("distinct expects a field name")),
    };
    let filter = match arg_doc(args, 1) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    match collection.distinct(field, filter).await {
        Ok(values) => {
            let array = values
                .into_iter()
                .map(serde_json::Value::from)
                .collect::<Vec<serde_json::Value>>();
            Ok(serde_json::Value::Array(array))
        }
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_drop(
    collection: &Collection<bson::Document>,
) -> Result<serde_json::Value, String> {
    match collection.drop().await {
        Ok(_) => Ok(ok_result()),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_create_index(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let keys = match arg_doc(args, 0) {
        Ok(doc) => doc,
        Err(e) => return Err(e),
    };
    let options_doc = match args.get(1) {
        Some(value) => match to_document(value) {
            Ok(doc) => doc,
            Err(e) => return Err(e),
        },
        None => bson::Document::new(),
    };
    // The builder is typed-state, so pass Options straight through rather than
    // conditionally reassigning (absent → None, i.e. unset).
    let unique = options_doc.get("unique").and_then(|value| value.as_bool());
    let name = options_doc
        .get("name")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let options = IndexOptions::builder().unique(unique).name(name).build();
    let model = IndexModel::builder()
        .keys(keys)
        .options(Some(options))
        .build();
    match collection.create_index(model).await {
        Ok(result) => {
            let mut out = serde_json::Map::new();
            out.insert(
                String::from("name"),
                serde_json::Value::from(result.index_name),
            );
            Ok(serde_json::Value::Object(out))
        }
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_drop_index(
    collection: &Collection<bson::Document>,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let name = match args.first().and_then(|value| value.as_str()) {
        Some(value) => value.to_string(),
        None => return Err(String::from("dropIndex expects an index name")),
    };
    match collection.drop_index(name).await {
        Ok(_) => Ok(ok_result()),
        Err(e) => Err(e.to_string()),
    }
}

async fn exec_rename(
    client: &Client,
    db_name: &str,
    collection_name: &str,
    args: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let target = match args.first().and_then(|value| value.as_str()) {
        Some(value) => value,
        None => return Err(String::from("renameCollection expects a target name")),
    };
    let mut command = bson::Document::new();
    command.insert(
        "renameCollection",
        format!("{}.{}", db_name, collection_name),
    );
    command.insert("to", format!("{}.{}", db_name, target));
    // renameCollection must run against the admin database.
    match client.database("admin").run_command(command).await {
        Ok(doc) => Ok(bson_doc_to_json(doc)),
        Err(e) => Err(e.to_string()),
    }
}

/// A minimal `{ ok: 1 }` acknowledgement for void operations.
fn ok_result() -> serde_json::Value {
    let mut out = serde_json::Map::new();
    out.insert(String::from("ok"), serde_json::Value::from(1));
    serde_json::Value::Object(out)
}

#[cfg(test)]
#[path = "bridge.test.rs"]
mod tests;
