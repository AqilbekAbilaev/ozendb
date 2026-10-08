//! Tests against a live server. Each file returns early unless its server's variable is
//! set (`OZENDB_TEST_MONGODB` for `mongodb.rs`, `OZENDB_TEST_POSTGRES` for the `pg*` files,
//! which share `pg.rs`'s helpers), so a plain `cargo test` stays green without one.
mod mongodb;
mod pg;
mod pg_activity;
mod pg_browse;
mod pg_cancel;
mod pg_command;
mod pg_ddl;
mod pg_delete;
mod pg_error;
mod pg_explain;
mod pg_insert;
mod pg_roles;
mod pg_routines;
mod pg_schema;
mod pg_serverinfo;
mod pg_ssh;
mod pg_statement;
mod pg_stats;
mod pg_transaction;
mod pg_transfer;
